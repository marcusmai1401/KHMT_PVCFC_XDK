from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.domain import FIMonthlyAllocationModel, SKCTKTModel, TeamReportModel
from app.services.fi.workflow import SKStatus
from app.services.okr.rules import normalize_assessment
from app.services.repositories import audit, make_id, model_to_dict


FI_QUOTA_BY_NORMALIZED_ASSESSMENT = {
    "Không hoàn thành": 0,
    "Hoàn thành": 1,
    "Hoàn thành tốt": 3,
    "Hoàn thành xuất sắc": 3,
}
FI_ALLOCATION_STRATEGY = "oldest_approved_first"
FI_ASSIGNABLE_STATUSES = {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
BUSINESS_TIMEZONE = timezone(timedelta(hours=7), name="Asia/Ho_Chi_Minh")


class FIAllocationError(ValueError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def quota_for_assessment(assessment: str | None) -> int:
    value = str(assessment or "").strip()
    normalized = normalize_assessment(value)
    try:
        return FI_QUOTA_BY_NORMALIZED_ASSESSMENT[normalized]
    except KeyError as exc:
        raise FIAllocationError(
            "FI_ASSESSMENT_UNSUPPORTED",
            "Mức đánh giá tháng không hợp lệ để tự phân bổ FI",
            {
                "assessment": value,
                "allowed_assessments": list(FI_QUOTA_BY_NORMALIZED_ASSESSMENT),
            },
        ) from exc


def _effective_approval_date(record: SKCTKTModel) -> datetime | None:
    return record.approved_at or record.submitted_at or record.created_at


def _as_utc(value: datetime) -> datetime:
    # SQLite drops timezone information. Application-generated values are UTC,
    # so treat a naive value as UTC before comparing or sorting it.
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _eligible_by_period(record: SKCTKTModel, month: int, year: int) -> bool:
    approved_on = _effective_approval_date(record)
    if approved_on is None:
        return False
    period_last_day = monthrange(year, month)[1]
    approved_business_date = _as_utc(approved_on).astimezone(BUSINESS_TIMEZONE).date()
    return approved_business_date <= datetime(year, month, period_last_day).date()


def _candidate_sort_key(record: SKCTKTModel) -> tuple[datetime, str, str]:
    approved_on = _effective_approval_date(record)
    date_key = _as_utc(approved_on) if approved_on is not None else datetime.max.replace(tzinfo=timezone.utc)
    return date_key, record.sk_code, record.id


def _record_summary(record: SKCTKTModel, *, already_assigned: bool) -> dict[str, Any]:
    approved_on = _effective_approval_date(record)
    return {
        "id": record.id,
        "sk_code": record.sk_code,
        "title": record.title,
        "author_name": record.author_name,
        "status": record.status,
        "approved_at": approved_on.isoformat() if approved_on is not None else None,
        "already_assigned": already_assigned,
    }


def _allocation_query(team: str, month: int, year: int):
    return select(FIMonthlyAllocationModel).where(
        FIMonthlyAllocationModel.team == team,
        FIMonthlyAllocationModel.month == month,
        FIMonthlyAllocationModel.year == year,
    )


def allocation_record_for_period(
    db: Session,
    team: str,
    month: int,
    year: int,
) -> FIMonthlyAllocationModel | None:
    return db.execute(_allocation_query(team, month, year)).scalar_one_or_none()


def allocation_record_to_dict(record: FIMonthlyAllocationModel | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return model_to_dict(record)


def _load_current_assignments(
    db: Session,
    team: str,
    month: int,
    year: int,
    *,
    lock: bool,
) -> list[SKCTKTModel]:
    query = select(SKCTKTModel).where(
        SKCTKTModel.team == team,
        SKCTKTModel.khmt_month == month,
        SKCTKTModel.khmt_year == year,
        or_(
            SKCTKTModel.consider_for_khmt.is_(True),
            SKCTKTModel.is_counted_for_okr.is_(True),
        ),
    )
    if lock:
        query = query.with_for_update()
    return list(db.execute(query).scalars())


def _load_unassigned_pool(db: Session, team: str, *, lock: bool) -> list[SKCTKTModel]:
    query = select(SKCTKTModel).where(
        SKCTKTModel.team == team,
        SKCTKTModel.status.in_(FI_ASSIGNABLE_STATUSES),
        SKCTKTModel.consider_for_khmt.is_(False),
        SKCTKTModel.is_counted_for_okr.is_(False),
        SKCTKTModel.khmt_month.is_(None),
        SKCTKTModel.khmt_year.is_(None),
    )
    if lock:
        query = query.with_for_update()
    return list(db.execute(query).scalars())


def _build_preview(
    db: Session,
    report: TeamReportModel,
    *,
    lock: bool,
) -> tuple[dict[str, Any], list[SKCTKTModel], list[SKCTKTModel]]:
    if report.team is None or report.report_month is None or report.report_year is None:
        raise FIAllocationError(
            "FI_REPORT_PERIOD_MISSING",
            "Báo cáo chưa xác định được đội hoặc kỳ để phân bổ FI",
        )
    team = report.team
    month = int(report.report_month)
    year = int(report.report_year)
    assessment = str((report.team_level or {}).get("monthly_assessment") or "").strip()
    required_count = quota_for_assessment(assessment)

    current_records = _load_current_assignments(db, team, month, year, lock=lock)
    valid_current = sorted(
        (
            record
            for record in current_records
            if record.status in FI_ASSIGNABLE_STATUSES
            and record.consider_for_khmt
            and record.is_counted_for_okr
            and _eligible_by_period(record, month, year)
        ),
        key=_candidate_sort_key,
    )
    unassigned_pool = sorted(
        (
            record
            for record in _load_unassigned_pool(db, team, lock=lock)
            if _eligible_by_period(record, month, year)
        ),
        key=_candidate_sort_key,
    )

    selected = [*valid_current[:required_count]]
    if len(selected) < required_count:
        selected.extend(unassigned_pool[: required_count - len(selected)])
    selected_ids = {record.id for record in selected}
    to_release = [record for record in current_records if record.id not in selected_ids]
    to_assign = [record for record in selected if record not in current_records]
    invalid_current = [record for record in current_records if record not in valid_current]
    available_count = len(valid_current) + len(unassigned_pool)
    shortage_count = max(0, required_count - available_count)
    existing_plan = allocation_record_for_period(db, team, month, year)

    preview = {
        "team": team,
        "month": month,
        "year": year,
        "assessment": assessment,
        "required_count": required_count,
        "currently_assigned_count": len(current_records),
        "eligible_current_count": len(valid_current),
        "unassigned_pool_count": len(unassigned_pool),
        "available_count": available_count,
        "shortage_count": shortage_count,
        "can_finalize": shortage_count == 0,
        "selection_strategy": FI_ALLOCATION_STRATEGY,
        "selected_records": [
            _record_summary(record, already_assigned=record in current_records)
            for record in selected
        ],
        "selected_sk_ids": [record.id for record in selected],
        "to_assign_sk_ids": [record.id for record in to_assign],
        "to_release_sk_ids": [record.id for record in to_release],
        "invalid_current_records": [
            _record_summary(record, already_assigned=True)
            for record in invalid_current
        ],
        "report_id": report.id,
        "report_version": report.version,
        "existing_allocation": allocation_record_to_dict(existing_plan),
    }
    return preview, selected, to_release


def preview_monthly_fi_allocation(db: Session, report: TeamReportModel) -> dict[str, Any]:
    preview, _, _ = _build_preview(db, report, lock=False)
    return preview


def _append_assignment_history(
    record: SKCTKTModel,
    *,
    actor: str,
    report: TeamReportModel,
    assessment: str,
    assigned: bool,
    changed_at: datetime,
) -> None:
    reason = "khmt_auto_assignment" if assigned else "khmt_auto_unassignment"
    history = {
        "from_status": record.status,
        "to_status": record.status,
        "changed_by": actor,
        "changed_at": changed_at.isoformat(),
        "reason": reason,
        "comments": {
            "khmt_month": report.report_month,
            "khmt_year": report.report_year,
            "monthly_assessment": assessment,
            "report_id": report.id,
            "report_version": report.version,
            "source": "monthly_assessment_auto",
        },
    }
    record.status_history = [*(record.status_history or []), history]
    record.updated_at = changed_at


def finalize_monthly_fi_allocation(
    db: Session,
    report: TeamReportModel,
    actor: str,
) -> dict[str, Any]:
    preview, selected, to_release = _build_preview(db, report, lock=True)
    if not preview["can_finalize"]:
        raise FIAllocationError(
            "FI_ALLOCATION_SHORTAGE",
            (
                f"{preview['team']} cần {preview['required_count']} FI cho mức "
                f"{preview['assessment']} nhưng chỉ có {preview['available_count']} FI hợp lệ"
            ),
            preview,
        )

    changed_at = _now()
    assessment = preview["assessment"]
    selected_ids = {record.id for record in selected}
    current_ids = {
        record.id
        for record in _load_current_assignments(
            db,
            preview["team"],
            preview["month"],
            preview["year"],
            lock=True,
        )
    }

    for record in to_release:
        previous = {
            "khmt_month": record.khmt_month,
            "khmt_year": record.khmt_year,
            "consider_for_khmt": record.consider_for_khmt,
            "is_counted_for_okr": record.is_counted_for_okr,
        }
        record.khmt_month = None
        record.khmt_year = None
        record.consider_for_khmt = False
        record.is_counted_for_okr = False
        _append_assignment_history(
            record,
            actor=actor,
            report=report,
            assessment=assessment,
            assigned=False,
            changed_at=changed_at,
        )
        audit(
            db,
            actor,
            "SK_CTKT",
            record.id,
            "auto_clear_khmt",
            {"before": previous, "report_id": report.id, "monthly_assessment": assessment},
        )

    for record in selected:
        if record.id in current_ids:
            continue
        record.khmt_month = preview["month"]
        record.khmt_year = preview["year"]
        record.consider_for_khmt = True
        record.is_counted_for_okr = True
        _append_assignment_history(
            record,
            actor=actor,
            report=report,
            assessment=assessment,
            assigned=True,
            changed_at=changed_at,
        )
        audit(
            db,
            actor,
            "SK_CTKT",
            record.id,
            "auto_assign_khmt",
            {
                "month": preview["month"],
                "year": preview["year"],
                "report_id": report.id,
                "monthly_assessment": assessment,
            },
        )

    plan_query = _allocation_query(preview["team"], preview["month"], preview["year"]).with_for_update()
    plan = db.execute(plan_query).scalar_one_or_none()
    before_plan = model_to_dict(plan) if plan is not None else None
    if plan is None:
        plan = FIMonthlyAllocationModel(
            id=make_id("fi-allocation"),
            team=preview["team"],
            month=preview["month"],
            year=preview["year"],
            assessment=assessment,
            required_count=preview["required_count"],
            allocated_count=len(selected_ids),
            available_count=preview["available_count"],
            selected_sk_ids=[record.id for record in selected],
            released_sk_ids=[record.id for record in to_release],
            allocation_strategy=FI_ALLOCATION_STRATEGY,
            status="finalized",
            report_id=report.id,
            report_version=report.version,
            finalized_by=actor,
            finalized_at=changed_at,
        )
        db.add(plan)
    else:
        plan.assessment = assessment
        plan.required_count = preview["required_count"]
        plan.allocated_count = len(selected_ids)
        plan.available_count = preview["available_count"]
        plan.selected_sk_ids = [record.id for record in selected]
        plan.released_sk_ids = [record.id for record in to_release]
        plan.allocation_strategy = FI_ALLOCATION_STRATEGY
        plan.status = "finalized"
        plan.report_id = report.id
        plan.report_version = report.version
        plan.finalized_by = actor
        plan.finalized_at = changed_at
        plan.updated_at = changed_at

    db.flush()
    after_plan = model_to_dict(plan)
    audit(
        db,
        actor,
        "FIMonthlyAllocation",
        plan.id,
        "finalize",
        {"before": before_plan, "after": after_plan},
    )
    return {**preview, "allocation": after_plan}


def mark_monthly_fi_allocation_reopened(
    db: Session,
    *,
    team: str,
    month: int,
    year: int,
    actor: str,
    reason: str,
) -> FIMonthlyAllocationModel | None:
    plan = db.execute(_allocation_query(team, month, year).with_for_update()).scalar_one_or_none()
    if plan is None:
        return None
    before = model_to_dict(plan)
    plan.status = "reopened"
    plan.updated_at = _now()
    db.flush()
    audit(
        db,
        actor,
        "FIMonthlyAllocation",
        plan.id,
        "reopen",
        {"before": before, "reason": reason},
    )
    return plan
