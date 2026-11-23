"""Monthly Team × KHMT (T1–T12) matrix & drill-down aggregation for FI Dashboard."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import Role
from app.models.domain import (
    FIMonthlyAllocationModel,
    FIPeriodWriteGuardModel,
    HistoricalSnapshotModel,
    SKCTKTModel,
    SKImageModel,
    TeamReportModel,
)
from app.services.fi.auto_completion import factory_today
from app.services.fi.completion import completion_plan_indicates_done
from app.services.fi.monthly_allocation import FIAllocationError, quota_for_assessment
from app.services.fi.workflow import SKStatus
from app.services.okr.rules import normalize_assessment

OKR_FI_TEAMS: tuple[str, ...] = ("TBCH", "TBĐL", "TBHTĐK", "TCĐK")
TEAM_DISPLAY_LABELS: dict[str, str] = {
    "Workshop_Staff": "Xưởng quản lí",
}
ASSIGNABLE_STATUSES: set[str] = {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
PENDING_STATUSES: set[str] = {
    SKStatus.SUBMITTED.value,
    SKStatus.NEED_MORE_INFO.value,
    SKStatus.REVIEWED.value,
}
NON_DRAFT_STATUSES: set[str] = {status.value for status in SKStatus if status != SKStatus.DRAFT}
MAX_MONTHLY_KHMT_QUOTA = 3


def display_team_name(team: str | None) -> str:
    if not team:
        return ""
    return TEAM_DISPLAY_LABELS.get(team, team)


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def registration_period_of(record: SKCTKTModel) -> tuple[int | None, int | None]:
    history = record.status_history if isinstance(record.status_history, list) else []
    first = history[0] if history and isinstance(history[0], dict) else {}
    comments = first.get("comments") if isinstance(first.get("comments"), dict) else {}
    month = _int_or_none(comments.get("registration_month"))
    year = _int_or_none(comments.get("registration_year"))
    created_at = _as_utc(record.created_at)
    if month is not None and 1 <= month <= 12:
        fallback_year = created_at.year if created_at is not None else _int_or_none(record.khmt_year)
        return month, year or fallback_year
    if created_at is not None:
        return created_at.month, created_at.year
    return None, year or _int_or_none(record.khmt_year)


def _is_done(record: SKCTKTModel) -> bool:
    return bool(
        record.status == SKStatus.COMPLETED.value
        or record.completed_at is not None
        or completion_plan_indicates_done(record.completion_plan)
    )


def _is_in_khmt(record: SKCTKTModel) -> bool:
    return bool(
        record.status in ASSIGNABLE_STATUSES
        and record.consider_for_khmt
        and record.khmt_month is not None
        and record.khmt_year is not None
    )


def _safe_quota(assessment: str | None) -> int | None:
    if not assessment:
        return None
    try:
        return quota_for_assessment(assessment)
    except FIAllocationError:
        return None


def _candidate_pool_sort_key(record: SKCTKTModel) -> tuple[datetime, str, str]:
    effective = record.approved_at or record.submitted_at or record.created_at
    dt = _as_utc(effective) if effective is not None else datetime.max.replace(tzinfo=timezone.utc)
    return dt, str(record.sk_code or ""), str(record.id)


def _load_period_metadata(
    db: Session,
    year: int,
) -> tuple[
    dict[tuple[str, int], dict[str, Any]],
    dict[tuple[str, int], FIMonthlyAllocationModel],
    dict[tuple[str, int], TeamReportModel],
    dict[tuple[str, int], str],
]:
    """Load lock guards, allocations, reports, and snapshots for one year in 4 bounded queries."""
    locks: dict[tuple[str, int], dict[str, Any]] = {}
    for guard in db.scalars(
        select(FIPeriodWriteGuardModel).where(
            FIPeriodWriteGuardModel.year == year,
            FIPeriodWriteGuardModel.is_locked.is_(True),
        )
    ):
        locks[(guard.team, int(guard.month))] = {
            "is_locked": True,
            "lock_reason": guard.lock_reason,
            "locked_by": guard.locked_by,
        }

    allocations: dict[tuple[str, int], FIMonthlyAllocationModel] = {}
    for alloc in db.scalars(
        select(FIMonthlyAllocationModel).where(FIMonthlyAllocationModel.year == year)
    ):
        allocations[(alloc.team, int(alloc.month))] = alloc

    reports: dict[tuple[str, int], TeamReportModel] = {}
    report_priority = {"locked": 3, "submitted": 2, "draft": 1}
    for report in db.scalars(
        select(TeamReportModel).where(
            TeamReportModel.report_year == year,
            TeamReportModel.is_current_version.is_(True),
            TeamReportModel.team.is_not(None),
            TeamReportModel.report_month.is_not(None),
        )
    ):
        key = (str(report.team), int(report.report_month))
        if report.report_status == "locked":
            locks.setdefault(
                key,
                {
                    "is_locked": True,
                    "lock_reason": report.lock_reason,
                    "locked_by": report.locked_by,
                },
            )
        existing = reports.get(key)
        if existing is None or report_priority.get(report.report_status, 0) > report_priority.get(existing.report_status, 0):
            reports[key] = report

    snapshots: dict[tuple[str, int], str] = {}
    for snap in db.scalars(
        select(HistoricalSnapshotModel)
        .where(
            HistoricalSnapshotModel.year == year,
            HistoricalSnapshotModel.team.in_(OKR_FI_TEAMS),
            HistoricalSnapshotModel.month.between(1, 12),
            HistoricalSnapshotModel.monthly_assessment.is_not(None),
        )
        .order_by(HistoricalSnapshotModel.imported_at.desc(), HistoricalSnapshotModel.id.desc())
    ):
        key = (str(snap.team), int(snap.month))
        text = str(snap.monthly_assessment or "").strip()
        if text and key not in snapshots:
            snapshots[key] = text

    return locks, allocations, reports, snapshots


def _resolve_cell_assessment(
    team: str,
    month: int,
    allocations: dict[tuple[str, int], FIMonthlyAllocationModel],
    reports: dict[tuple[str, int], TeamReportModel],
    snapshots: dict[tuple[str, int], str],
) -> tuple[str | None, str | None, int | None, str | None]:
    key = (team, month)
    alloc = allocations.get(key)
    allocation_status = alloc.status if alloc is not None else None
    if alloc is not None and alloc.status == "finalized" and alloc.assessment:
        normalized = normalize_assessment(alloc.assessment) or alloc.assessment
        return normalized, "allocation", int(alloc.required_count), allocation_status

    report = reports.get(key)
    if report is not None:
        raw = str((report.team_level or {}).get("monthly_assessment") or "").strip()
        if raw:
            normalized = normalize_assessment(raw) or raw
            return normalized, "team_report", _safe_quota(normalized), allocation_status

    snap_raw = snapshots.get(key)
    if snap_raw:
        normalized = normalize_assessment(snap_raw) or snap_raw
        return normalized, "historical_snapshot", _safe_quota(normalized), allocation_status

    return None, None, None, allocation_status


def _classify_cell(
    *,
    count: int,
    year: int,
    month: int,
    today: date,
    required_count: int | None,
) -> tuple[str, str, bool, bool]:
    is_current_month = year == today.year and month == today.month
    is_future_month = year > today.year or (year == today.year and month > today.month)

    if is_future_month and count == 0:
        kr_tier = "future"
    elif count >= MAX_MONTHLY_KHMT_QUOTA:
        kr_tier = "good"
    elif count >= 1:
        kr_tier = "ok"
    elif required_count == 0:
        kr_tier = "exempt_zero"
    else:
        kr_tier = "none"

    if required_count is not None:
        # A team rated "Không hoàn thành" (required_count == 0) due to a non-FI KR
        # (e.g. safety/discipline) normally still counts 1 FI for O5.KR13.
        if count == required_count or (required_count == 0 and count == 1):
            quota_status = "matched"
        elif count < required_count:
            quota_status = "shortage"
        else:
            quota_status = "excess"
    else:
        if count > MAX_MONTHLY_KHMT_QUOTA:
            quota_status = "excess"
        elif count == 0 and not is_future_month:
            quota_status = "missing_fi"
        else:
            quota_status = "no_report"

    return kr_tier, quota_status, is_current_month, is_future_month


def _empty_year_summary() -> dict[str, int]:
    return {
        "total": 0,
        "approved": 0,
        "review_passed": 0,
        "review_failed": 0,
        "rejected": 0,
        "deferred": 0,
        "pending": 0,
        "cancelled": 0,
        "khmt_considered": 0,
        "khmt_not_considered": 0,
        "khmt_unassigned_approved": 0,
        "completed_count": 0,
        "not_completed": 0,
    }


def _accumulate_summary(bucket: dict[str, int], record: SKCTKTModel, *, year: int | None = None) -> None:
    status = record.status
    bucket["total"] += 1
    if status in ASSIGNABLE_STATUSES:
        bucket["approved"] += 1
        bucket["review_passed"] += 1
    if status == SKStatus.REJECTED.value:
        bucket["rejected"] += 1
        bucket["review_failed"] += 1
    if status == SKStatus.DEFERRED.value:
        bucket["deferred"] += 1
    if status in PENDING_STATUSES:
        bucket["pending"] += 1
    if status == SKStatus.CANCELLED.value:
        bucket["cancelled"] += 1
    if _is_done(record):
        bucket["completed_count"] += 1
    else:
        bucket["not_completed"] += 1

    in_khmt = _is_in_khmt(record) and (year is None or int(record.khmt_year or 0) == year)
    if in_khmt:
        bucket["khmt_considered"] += 1
    elif status in ASSIGNABLE_STATUSES and not bool(record.consider_for_khmt):
        bucket["khmt_not_considered"] += 1
        bucket["khmt_unassigned_approved"] += 1


def build_fi_dashboard_matrix_payload(
    db: Session,
    visible_records: list[SKCTKTModel],
    *,
    year: int | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Compute Team × Month (T1–T12) KHMT & Registration matrices + year-scoped summaries."""
    ref_today = today or factory_today()
    selected_year = int(year) if year is not None else ref_today.year

    years_seen: set[int] = {ref_today.year, selected_year}
    for record in visible_records:
        if record.khmt_year:
            years_seen.add(int(record.khmt_year))
        _, reg_year = registration_period_of(record)
        if reg_year:
            years_seen.add(int(reg_year))
    available_years = sorted(years_seen, reverse=True)

    locks, allocations, reports, snapshots = _load_period_metadata(db, selected_year)

    khmt_counts: dict[tuple[str, int], int] = {}
    reg_counts: dict[tuple[str, int], int] = {}
    reg_approved_counts: dict[tuple[str, int], int] = {}
    reg_khmt_counts: dict[tuple[str, int], int] = {}

    # All-time team pools (approved unassigned & currently pending) are operational queues,
    # while monthly columns & year totals are strictly scoped to selected_year.
    pool_unassigned_by_team: dict[str, int] = {team: 0 for team in OKR_FI_TEAMS}
    pending_by_team: dict[str, int] = {team: 0 for team in OKR_FI_TEAMS}
    deferred_by_team: dict[str, int] = {team: 0 for team in OKR_FI_TEAMS}
    rejected_by_team: dict[str, int] = {team: 0 for team in OKR_FI_TEAMS}
    approved_by_team: dict[str, int] = {team: 0 for team in OKR_FI_TEAMS}
    total_sk_by_team: dict[str, int] = {team: 0 for team in OKR_FI_TEAMS}

    non_okr_teams: dict[str, dict[str, Any]] = {}
    selected_year_totals = _empty_year_summary()
    selected_year_teams_map: dict[str, dict[str, Any]] = {
        team: {"team": team, "display_name": display_team_name(team), **_empty_year_summary()}
        for team in OKR_FI_TEAMS
    }

    for record in visible_records:
        team = str(record.team or "")
        reg_month, reg_year = registration_period_of(record)
        in_khmt = _is_in_khmt(record)
        in_khmt_selected_year = in_khmt and int(record.khmt_year or 0) == selected_year
        registered_selected_year = reg_year == selected_year

        if registered_selected_year or in_khmt_selected_year:
            _accumulate_summary(selected_year_totals, record, year=selected_year)
            team_year_bucket = selected_year_teams_map.setdefault(
                team,
                {"team": team, "display_name": display_team_name(team), **_empty_year_summary()},
            )
            _accumulate_summary(team_year_bucket, record, year=selected_year)

        if team in OKR_FI_TEAMS:
            total_sk_by_team[team] += 1
            if record.status in ASSIGNABLE_STATUSES:
                approved_by_team[team] += 1
                if not bool(record.consider_for_khmt):
                    pool_unassigned_by_team[team] += 1
            if record.status in PENDING_STATUSES:
                pending_by_team[team] += 1
            if record.status == SKStatus.DEFERRED.value:
                deferred_by_team[team] += 1
            if record.status == SKStatus.REJECTED.value:
                rejected_by_team[team] += 1

            if in_khmt_selected_year and record.khmt_month is not None:
                key = (team, int(record.khmt_month))
                khmt_counts[key] = khmt_counts.get(key, 0) + 1

            if registered_selected_year and reg_month is not None:
                rkey = (team, int(reg_month))
                reg_counts[rkey] = reg_counts.get(rkey, 0) + 1
                if record.status in ASSIGNABLE_STATUSES:
                    reg_approved_counts[rkey] = reg_approved_counts.get(rkey, 0) + 1
                if in_khmt:
                    reg_khmt_counts[rkey] = reg_khmt_counts.get(rkey, 0) + 1
        elif team:
            entry = non_okr_teams.setdefault(
                team,
                {
                    "team": team,
                    "display_name": display_team_name(team),
                    "total_sk": 0,
                    "approved_total": 0,
                    "approved_unassigned_count": 0,
                    "pending_count": 0,
                    "deferred_count": 0,
                    "rejected_count": 0,
                    "year_khmt_total": 0,
                    "year_registration_total": 0,
                },
            )
            entry["total_sk"] += 1
            if record.status in ASSIGNABLE_STATUSES:
                entry["approved_total"] += 1
                if not bool(record.consider_for_khmt):
                    entry["approved_unassigned_count"] += 1
            if record.status in PENDING_STATUSES:
                entry["pending_count"] += 1
            if record.status == SKStatus.DEFERRED.value:
                entry["deferred_count"] += 1
            if record.status == SKStatus.REJECTED.value:
                entry["rejected_count"] += 1
            if in_khmt_selected_year:
                entry["year_khmt_total"] += 1
            if registered_selected_year:
                entry["year_registration_total"] += 1

    # Sync selected_year_totals unassigned pool with the actual current pool across all visible records
    # so KPI "kho sẵn sàng" always matches the Matrix column "Kho sẵn sàng".
    total_pool_okr = sum(pool_unassigned_by_team.values())
    total_pool_all = total_pool_okr + sum(item["approved_unassigned_count"] for item in non_okr_teams.values())
    selected_year_totals["khmt_unassigned_approved"] = total_pool_all
    selected_year_totals["khmt_not_considered"] = total_pool_all
    # Same for each team card, so "còn N kho sẵn sàng" equals the matrix column.
    for team_key, bucket in selected_year_teams_map.items():
        if team_key in pool_unassigned_by_team:
            team_pool = pool_unassigned_by_team[team_key]
        else:
            team_pool = int(non_okr_teams.get(team_key, {}).get("approved_unassigned_count", 0))
        bucket["khmt_unassigned_approved"] = team_pool
        bucket["khmt_not_considered"] = team_pool

    khmt_rows: list[dict[str, Any]] = []
    reg_rows: list[dict[str, Any]] = []
    workshop_khmt_months = {month: 0 for month in range(1, 13)}
    workshop_reg_months = {month: 0 for month in range(1, 13)}

    for team in OKR_FI_TEAMS:
        month_cells: list[dict[str, Any]] = []
        reg_month_cells: list[dict[str, Any]] = []
        year_khmt_total = 0
        year_reg_total = 0

        for month in range(1, 13):
            count = khmt_counts.get((team, month), 0)
            year_khmt_total += count
            workshop_khmt_months[month] += count

            lock_info = locks.get((team, month))
            is_locked = bool(lock_info and lock_info.get("is_locked"))
            assessment, assessment_source, required_count, allocation_status = _resolve_cell_assessment(
                team, month, allocations, reports, snapshots
            )
            kr_tier, quota_status, is_current_month, is_future_month = _classify_cell(
                count=count,
                year=selected_year,
                month=month,
                today=ref_today,
                required_count=required_count,
            )
            month_cells.append(
                {
                    "month": month,
                    "count": count,
                    "kr_tier": kr_tier,
                    "is_current_month": is_current_month,
                    "is_future_month": is_future_month,
                    "is_locked": is_locked,
                    "lock_reason": lock_info.get("lock_reason") if lock_info else None,
                    "allocation_status": allocation_status,
                    "report_assessment": assessment,
                    "assessment_source": assessment_source,
                    "required_count": required_count,
                    "quota_status": quota_status,
                }
            )

            rcount = reg_counts.get((team, month), 0)
            year_reg_total += rcount
            workshop_reg_months[month] += rcount
            reg_month_cells.append(
                {
                    "month": month,
                    "count": rcount,
                    "approved_count": reg_approved_counts.get((team, month), 0),
                    "in_khmt_count": reg_khmt_counts.get((team, month), 0),
                    "is_current_month": is_current_month,
                    "is_future_month": is_future_month,
                }
            )

        khmt_rows.append(
            {
                "team": team,
                "display_name": display_team_name(team),
                "months": month_cells,
                "year_khmt_total": year_khmt_total,
                "approved_total": approved_by_team[team],
                "approved_unassigned_count": pool_unassigned_by_team[team],
                "pending_count": pending_by_team[team],
                "deferred_count": deferred_by_team[team],
                "rejected_count": rejected_by_team[team],
                "total_sk": total_sk_by_team[team],
            }
        )
        reg_rows.append(
            {
                "team": team,
                "display_name": display_team_name(team),
                "months": reg_month_cells,
                "year_total": year_reg_total,
                "approved_unassigned_count": pool_unassigned_by_team[team],
                "pending_count": pending_by_team[team],
            }
        )

    non_okr_summary = sorted(non_okr_teams.values(), key=lambda item: item["display_name"])

    return {
        "current_year": ref_today.year,
        "current_month": ref_today.month,
        "year": selected_year,
        "available_years": available_years,
        "selected_year_totals": selected_year_totals,
        "selected_year_teams": list(selected_year_teams_map.values()),
        "khmt_matrix": {
            "year": selected_year,
            "okr_teams": list(OKR_FI_TEAMS),
            "rows": khmt_rows,
            "workshop_totals": {
                "months": [{"month": month, "count": workshop_khmt_months[month]} for month in range(1, 13)],
                "year_khmt_total": sum(workshop_khmt_months.values()),
                "approved_total": sum(approved_by_team.values()),
                "approved_unassigned_count": total_pool_okr,
                "pending_count": sum(pending_by_team.values()),
                "deferred_count": sum(deferred_by_team.values()),
                "rejected_count": sum(rejected_by_team.values()),
                "total_sk": sum(total_sk_by_team.values()),
            },
            "non_okr_summary": non_okr_summary,
        },
        "registration_matrix": {
            "year": selected_year,
            "okr_teams": list(OKR_FI_TEAMS),
            "rows": reg_rows,
            "workshop_totals": {
                "months": [{"month": month, "count": workshop_reg_months[month]} for month in range(1, 13)],
                "year_total": sum(workshop_reg_months.values()),
                "approved_unassigned_count": total_pool_okr,
                "pending_count": sum(pending_by_team.values()),
            },
            "non_okr_summary": non_okr_summary,
        },
    }


def _image_counts_for_records(db: Session, record_ids: list[str]) -> dict[str, int]:
    if not record_ids:
        return {}
    rows = db.execute(
        select(SKImageModel.sk_ctkt_id, func.count(SKImageModel.id))
        .where(SKImageModel.sk_ctkt_id.in_(record_ids))
        .group_by(SKImageModel.sk_ctkt_id)
    ).all()
    return {str(sk_id): int(count) for sk_id, count in rows}


def _can_edit_team_khmt(
    principal: dict[str, Any],
    team: str,
    *,
    is_locked: bool,
) -> tuple[bool, str | None]:
    if team not in OKR_FI_TEAMS:
        return False, "Khối này không nằm trong ma trận KHMT của 4 đội/tổ."
    if is_locked:
        return False, "Kỳ báo cáo này đã chốt. Cần Quản trị mở chốt tại Quản trị → Chốt KHMT & FI trước khi điều chỉnh."
    role = principal.get("role")
    if role == Role.ADMIN.value:
        return True, None
    if role == Role.TEAM_ACCOUNT.value:
        principal_team = principal.get("team") or principal.get("user_id")
        if principal_team == team:
            return True, None
        return False, f"Tài khoản đội/tổ chỉ được phân bổ KHMT cho đội {display_team_name(principal_team)}."
    return False, "Chỉ Đội/Tổ trưởng của đội hoặc Quản trị mới được phân bổ SK vào KHMT."


def get_fi_dashboard_cell(
    db: Session,
    *,
    team: str,
    year: int,
    month: int,
    mode: str,
    principal: dict[str, Any],
    serializer: Callable[[SKCTKTModel, Session], dict[str, Any]],
    today: date | None = None,
) -> dict[str, Any]:
    ref_today = today or factory_today()
    normalized_mode = "registration" if mode == "registration" else "khmt"
    locks, allocations, reports, snapshots = _load_period_metadata(db, year)
    lock_info = locks.get((team, month))
    is_locked = bool(lock_info and lock_info.get("is_locked"))
    assessment, assessment_source, required_count, allocation_status = _resolve_cell_assessment(
        team, month, allocations, reports, snapshots
    )

    team_records = list(
        db.scalars(
            select(SKCTKTModel)
            .where(
                SKCTKTModel.team == team,
                SKCTKTModel.status.in_(NON_DRAFT_STATUSES),
            )
            .order_by(
                func.coalesce(SKCTKTModel.created_at, SKCTKTModel.submitted_at, SKCTKTModel.updated_at).desc(),
                SKCTKTModel.id.desc(),
            )
        )
    )

    if normalized_mode == "khmt":
        cell_records = [
            record
            for record in team_records
            if _is_in_khmt(record)
            and int(record.khmt_year or 0) == year
            and int(record.khmt_month or 0) == month
        ]
        cell_records.sort(key=_candidate_pool_sort_key)
    else:
        cell_records = [
            record
            for record in team_records
            if registration_period_of(record) == (month, year)
        ]

    available_pool_records = (
        sorted(
            (
                record
                for record in team_records
                if record.status in ASSIGNABLE_STATUSES and not bool(record.consider_for_khmt)
            ),
            key=_candidate_pool_sort_key,
        )
        if normalized_mode == "khmt"
        else []
    )
    pending_count = sum(1 for record in team_records if record.status in PENDING_STATUSES)

    all_ids = [record.id for record in cell_records] + [record.id for record in available_pool_records]
    image_counts = _image_counts_for_records(db, all_ids)

    kr_tier, quota_status, is_current_month, is_future_month = _classify_cell(
        count=len(cell_records),
        year=year,
        month=month,
        today=ref_today,
        required_count=required_count,
    )
    can_edit, blocked_reason = _can_edit_team_khmt(principal, team, is_locked=is_locked)

    def _hydrate(record: SKCTKTModel) -> dict[str, Any]:
        payload = serializer(record, db)
        payload["image_count"] = image_counts.get(record.id, 0)
        return payload

    return {
        "team": team,
        "display_name": display_team_name(team),
        "year": year,
        "month": month,
        "mode": normalized_mode,
        "cell": {
            "count": len(cell_records),
            "kr_tier": kr_tier,
            "is_current_month": is_current_month,
            "is_future_month": is_future_month,
            "is_locked": is_locked,
            "lock_reason": lock_info.get("lock_reason") if lock_info else None,
            "allocation_status": allocation_status,
            "report_assessment": assessment,
            "assessment_source": assessment_source,
            "required_count": required_count,
            "quota_status": quota_status,
            "can_edit_khmt": can_edit,
            "edit_blocked_reason": blocked_reason,
            "pending_count_for_team": pending_count,
        },
        "items": [_hydrate(record) for record in cell_records],
        "available_pool": [_hydrate(record) for record in available_pool_records],
    }


def get_fi_dashboard_pool(
    db: Session,
    *,
    team: str,
    kind: str,
    principal: dict[str, Any],
    serializer: Callable[[SKCTKTModel, Session], dict[str, Any]],
) -> dict[str, Any]:
    normalized_kind = "pending" if kind == "pending" else "unassigned_approved"
    query = select(SKCTKTModel).where(SKCTKTModel.team == team)
    if normalized_kind == "pending":
        query = query.where(SKCTKTModel.status.in_(PENDING_STATUSES)).order_by(
            func.coalesce(SKCTKTModel.submitted_at, SKCTKTModel.created_at).desc(),
            SKCTKTModel.id.desc(),
        )
        records = list(db.scalars(query))
    else:
        query = query.where(
            SKCTKTModel.status.in_(ASSIGNABLE_STATUSES),
            SKCTKTModel.consider_for_khmt.is_(False),
        )
        records = sorted(db.scalars(query), key=_candidate_pool_sort_key)

    image_counts = _image_counts_for_records(db, [record.id for record in records])
    can_edit, blocked_reason = _can_edit_team_khmt(principal, team, is_locked=False)

    items = []
    for record in records:
        payload = serializer(record, db)
        payload["image_count"] = image_counts.get(record.id, 0)
        items.append(payload)

    return {
        "team": team,
        "display_name": display_team_name(team),
        "kind": normalized_kind,
        "total": len(items),
        "can_edit_khmt": can_edit,
        "edit_blocked_reason": blocked_reason,
        "items": items,
    }
