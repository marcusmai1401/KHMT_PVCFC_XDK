from __future__ import annotations
from app.services.repositories import public_report_dict

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import and_, desc, func, select, update
from types import SimpleNamespace
import copy
from sqlalchemy.orm import Session, attributes

from app.core.security import Role
from app.models.domain import SKCTKTModel, TeamReportModel
from app.schemas.web_input import MonthlyConclusionInput, WebInputPayload
from app.services.cache import cache_delete_prefix
from app.services.fi.monthly_allocation import (
    FIAllocationError,
    allocation_record_for_period,
    allocation_record_to_dict,
    finalize_monthly_fi_allocation,
    mark_monthly_fi_allocation_reopened,
    preview_monthly_fi_allocation,
)
from app.services.fi.period_guard import (
    assert_period_mutable,
    assert_period_state_mutable,
    lock_period_state,
    mark_period_locked,
    mark_period_unlocked,
)
from app.services.fi.team_guard import lock_fi_team
from app.services.okr.constants import TEAMS
from app.services.okr.email_report import generate_email_report, write_email_report_file
from app.services.okr.extraction import extract_metrics
from app.services.okr.kr_mapping import mapping_by_code
from app.services.okr.report_template import generate_excel_from_web_input, hash_file
from app.services.okr.rules import map_to_dashboard_status
from app.services.okr.validation import validate_month_year, validate_web_input_payload
from app.services.repositories import audit, make_id, model_to_dict, warning_from_dict


DISPLAY_STATUS = {
    "draft": "Đang nhập",
    "submitted": "Đã gửi",
    "locked": "Đã chốt",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _error(status_code: int, error_code: str, message: str, details: Any = None) -> HTTPException:
    payload: dict[str, Any] = {
        "code": error_code,
        # Backwards-compatible alias for clients released before the audit remediation.
        "error_code": error_code,
        "message": message,
        "request_id": str(uuid4()),
    }
    if details is not None:
        payload["details"] = details
        payload["fields"] = details if isinstance(details, dict) else {"items": details}
    return HTTPException(status_code=status_code, detail=payload)


def assert_team_access(principal: dict[str, str], team: str, *, write: bool) -> None:
    role = principal["role"]
    if role == Role.ADMIN.value:
        return
    if role == Role.TEAM_ACCOUNT.value:
        if write:
            raise _error(403, "FORBIDDEN", "Chỉ Admin được nhập/sửa OKR")
        principal_team = principal.get("team") or principal["user_id"]
        if principal_team != team:
            raise _error(403, "TEAM_MISMATCH", "Tài khoản đội/tổ chỉ được thao tác dữ liệu của đội mình")
        return
    if not write and role in {Role.WORKSHOP_LEADER.value, Role.FI_COORDINATOR.value, Role.STAFF.value}:
        return
    raise _error(403, "FORBIDDEN", "Tài khoản không có quyền thực hiện thao tác này")


def _base_query(team: str, month: int, year: int):
    return and_(
        TeamReportModel.team == team,
        TeamReportModel.report_month == month,
        TeamReportModel.report_year == year,
    )


def _reports_for_period(db: Session, team: str, month: int, year: int) -> list[TeamReportModel]:
    return list(
        db.execute(
            select(TeamReportModel)
            .where(_base_query(team, month, year))
            .order_by(desc(TeamReportModel.uploaded_at), desc(TeamReportModel.submitted_at))
        ).scalars()
    )


def _current_draft(
    db: Session,
    team: str,
    month: int,
    year: int,
    *,
    lock: bool = False,
) -> TeamReportModel | None:
    query = select(TeamReportModel).where(
        _base_query(team, month, year),
        TeamReportModel.source_type == "web_input",
        TeamReportModel.report_status == "draft",
        TeamReportModel.is_current_version.is_(True),
    ).order_by(desc(TeamReportModel.last_auto_save), desc(TeamReportModel.uploaded_at))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return db.execute(query).scalar_one_or_none()


def current_submitted_report(
    db: Session,
    team: str,
    month: int,
    year: int,
    *,
    lock: bool = False,
) -> TeamReportModel | None:
    query = select(TeamReportModel).where(
        _base_query(team, month, year),
        TeamReportModel.report_status.in_(["submitted", "locked"]),
        TeamReportModel.is_current_version.is_(True),
    ).order_by(desc(TeamReportModel.submitted_at), desc(TeamReportModel.uploaded_at))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return db.execute(query).scalar_one_or_none()


def _current_locked(db: Session, team: str, month: int, year: int) -> TeamReportModel | None:
    return db.execute(
        select(TeamReportModel)
        .where(
            _base_query(team, month, year),
            TeamReportModel.report_status == "locked",
            TeamReportModel.is_current_version.is_(True),
        )
        .order_by(desc(TeamReportModel.locked_at), desc(TeamReportModel.submitted_at))
    ).scalar_one_or_none()


def get_current_input_report(db: Session, team: str, month: int, year: int) -> TeamReportModel | None:
    return _current_draft(db, team, month, year) or current_submitted_report(db, team, month, year)


def _monthly_to_team_level(conclusion: MonthlyConclusionInput, objective_overrides: dict[str, str | None]) -> dict[str, Any]:
    clean_overrides = {key: value for key, value in objective_overrides.items() if value}
    return {
        "monthly_assessment": conclusion.overall_assessment,
        "discipline_status": conclusion.discipline_status,
        "discipline_description": conclusion.discipline_description or "",
        "discipline_violators": list(conclusion.discipline_violators or []),
        "detailed_description": conclusion.detailed_description or "",
        "objective_overrides": clean_overrides,
    }


def _payload_from_report(report: TeamReportModel | None) -> dict[str, Any]:
    if report is None:
        master = sorted(mapping_by_code().values(), key=lambda item: (int(item.workshop_kr_code[1]), int(item.workshop_kr_code.split("KR", 1)[1])))
        return {
            "kr_assessments": [
                {
                    "workshop_kr_code": item.workshop_kr_code,
                    "implementation_report": "",
                    "team_self_assessment": None,
                    "notes": "",
                }
                for item in master
            ],
            "arising_work": [],
            "monthly_conclusion": {
                "discipline_status": "OK",
                "discipline_description": "",
                "discipline_violators": [],
                "overall_assessment": "Hoàn thành nhiệm vụ",
                "detailed_description": "",
            },
            "objective_overrides": {},
        }
    team_level = report.team_level or {}
    return {
        "kr_assessments": [
            {
                "workshop_kr_code": item.get("workshop_kr_code"),
                "implementation_report": item.get("implementation_report") or "",
                "team_self_assessment": item.get("team_self_assessment") or None,
                "notes": item.get("notes") or "",
            }
            for item in (report.assessments or [])
        ],
        "arising_work": report.arising_work or [],
        "monthly_conclusion": {
            "discipline_status": team_level.get("discipline_status") or "OK",
            "discipline_description": team_level.get("discipline_description") or "",
            "discipline_violators": team_level.get("discipline_violators") or [],
            "overall_assessment": team_level.get("monthly_assessment") or "Hoàn thành nhiệm vụ",
            "detailed_description": team_level.get("detailed_description") or "",
        },
        "objective_overrides": team_level.get("objective_overrides") or {},
    }


def _build_assessments(payload: WebInputPayload) -> list[dict[str, Any]]:
    master = mapping_by_code()
    by_code = {item.workshop_kr_code: item for item in payload.kr_assessments}
    assessments: list[dict[str, Any]] = []
    for code, mapping in sorted(master.items(), key=lambda row: (int(row[0][1]), int(row[0].split("KR", 1)[1]))):
        item = by_code.get(code)
        implementation_report = item.implementation_report if item else ""
        assessment = item.team_self_assessment if item else None
        notes = item.notes if item else ""
        metrics = [metric.to_dict() for metric in extract_metrics(implementation_report or "", code)]
        has_plan = assessment != "N/A"
        assessments.append(
            {
                "workshop_kr_code": code,
                "kr_name": mapping.kr_name,
                "dashboard_status": map_to_dashboard_status(assessment, has_plan=has_plan) if assessment else "#N/A",
                "team_self_assessment": assessment,
                "has_plan": has_plan,
                "implementation_report": implementation_report or "",
                "notes": notes or "",
                "metrics": metrics,
            }
        )
    return assessments


def _summary_counts(assessments: list[dict[str, Any]]) -> dict[str, int]:
    keys = ["Hoàn thành xuất sắc", "Hoàn thành tốt", "Hoàn thành", "Không hoàn thành", "N/A", "Chưa chọn"]
    counts = {key: 0 for key in keys}
    for item in assessments:
        assessment = item.get("team_self_assessment") or "Chưa chọn"
        counts[assessment] = counts.get(assessment, 0) + 1
    return counts


def _write_generated_files(report: TeamReportModel) -> tuple[Path, Path]:
    excel_path = generate_excel_from_web_input(report)
    email_path = write_email_report_file(report)
    report.file_name = excel_path.name
    report.file_path = str(excel_path)
    report.file_hash = hash_file(excel_path)
    return excel_path, email_path


def _render_after_content_commit(db: Session, report: TeamReportModel) -> None:
    """A file failure cannot undo acknowledged editor content."""
    snapshot = SimpleNamespace(**{column.name: copy.deepcopy(getattr(report, column.name)) for column in TeamReportModel.__table__.columns})
    try:
        _write_generated_files(snapshot)
        # Another writer may have saved while rendering. Never attach an old
        # workbook to its newer content; the uniquely named file stays intact.
        db.execute(update(TeamReportModel).where(
            TeamReportModel.id == snapshot.id,
            TeamReportModel.revision == snapshot.revision,
        ).values(file_name=snapshot.file_name, file_path=snapshot.file_path, file_hash=snapshot.file_hash).execution_options(synchronize_session=False))
        db.commit()
    except Exception:
        db.rollback()
        snapshot.file_path = ""
        snapshot.file_hash = ""
        # The committed content remains downloadable and export can be retried.
    # A response acknowledges this operation's revision, not a later writer.
    for column in TeamReportModel.__table__.columns:
        attributes.set_committed_value(report, column.name, getattr(snapshot, column.name))


def serialize_web_input(report: TeamReportModel | None, team: str, month: int, year: int) -> dict[str, Any]:
    status = "Chưa nhập" if report is None else DISPLAY_STATUS.get(report.report_status, report.report_status)
    payload = _payload_from_report(report)
    warnings = []
    errors = []
    email_text = ""
    if report is not None:
        _, validation_warnings = validate_web_input_payload(WebInputPayload(**payload), require_complete=False)
        warnings = [warning.to_dict() for warning in validation_warnings]
        email_text = generate_email_report(report)
    return {
        "team": team,
        "month": month,
        "year": year,
        "status": status,
        "report": public_report_dict(report) if report is not None else None,
        "data": payload,
        "version": report.version if report is not None else None,
        "server_revision": report.revision if report is not None else None,
        "last_saved_at": report.last_auto_save.isoformat() if report and report.last_auto_save else None,
        "submitted_at": report.submitted_at.isoformat() if report and report.submitted_at else None,
        "locked": bool(report and report.report_status == "locked"),
        "validation_errors": errors,
        "warnings": warnings + ([{"code": "ARTIFACT_PENDING", "message": "Nội dung đã lưu; file chưa tạo được. Có thể thử xuất file lại."}] if report and not report.file_path else []),
        "artifact_status": "pending" if report and not report.file_path else "ready",
        "email_text": email_text,
        "summary_counts": _summary_counts(report.assessments if report else []),
    }


def save_draft(
    db: Session,
    team: str,
    month: int,
    year: int,
    payload: WebInputPayload,
    principal: dict[str, str],
    expected_version: int | None = None,
    expected_revision: int | None = None,
) -> TeamReportModel:
    assert_team_access(principal, team, write=True)
    period_errors = validate_month_year(month, year)
    if period_errors:
        raise _error(400, "VALIDATION_ERROR", "Kỳ báo cáo không hợp lệ", [item.to_dict() for item in period_errors])
    lock_fi_team(db, team)
    period_guard = lock_period_state(db, team, month, year)
    assert_period_state_mutable(period_guard, team, month, year)
    assert_period_mutable(db, team, month, year)
    if _current_locked(db, team, month, year):
        raise _error(409, "REPORT_LOCKED", "Báo cáo đã chốt, không thể chỉnh sửa")
    report = _current_draft(db, team, month, year, lock=True)
    published = current_submitted_report(db, team, month, year, lock=True) if report is None else None
    now = _now()
    if expected_revision is not None:
        current_revision = report.revision if report is not None else (published.revision if published is not None else 0)
        if current_revision != expected_revision:
            raise _error(
                409,
                "VERSION_CONFLICT",
                "Draft đã được cập nhật ở nơi khác",
                {"current_revision": current_revision, "revision": current_revision},
            )
    elif report is not None and expected_version is not None and report.version != expected_version:
        raise _error(409, "VERSION_CONFLICT", "Draft đã được cập nhật ở nơi khác", {"version": report.version})
    if report is None:
        report = TeamReportModel(
            id=make_id("report"),
            team=team,
            report_month=month,
            report_year=year,
            file_name=f"bao-cao-okr-{team}-T{month}-{year}-draft.xlsx",
            file_path="",
            file_hash="",
            version=1,
            is_current_version=True,
            uploaded_by=principal["user_id"],
            uploaded_at=now,
            sheet_name=team,
            source_type="web_input",
            report_status="draft",
            revision=(published.revision if published is not None else 0) + 1,
        )
        db.add(report)
    else:
        report.version += 1
        report.revision += 1
        report.uploaded_at = now

    report.assessments = _build_assessments(payload)
    report.team_level = _monthly_to_team_level(payload.monthly_conclusion, payload.objective_overrides)
    report.arising_work = [item.model_dump() for item in payload.arising_work]
    report.last_auto_save = now
    report.validation_status = "DRAFT"
    report.parsing_status = "WEB_INPUT"
    db.flush()
    report.file_path = ""
    report.file_hash = ""
    audit(db, principal["user_id"], "TeamReport", report.id, "save_draft", {"team": team, "month": month, "year": year, "version": report.version})
    db.commit()
    _render_after_content_commit(db, report)
    return report


def submit_report(
    db: Session,
    team: str,
    month: int,
    year: int,
    payload: WebInputPayload,
    principal: dict[str, str],
    expected_revision: int | None = None,
) -> TeamReportModel:
    assert_team_access(principal, team, write=True)
    period_errors = validate_month_year(month, year)
    validation_errors, _ = validate_web_input_payload(payload, require_complete=True)
    errors = period_errors + validation_errors
    if errors:
        raise _error(400, "VALIDATION_ERROR", "Dữ liệu chưa đủ điều kiện gửi", [item.to_dict() for item in errors])
    lock_fi_team(db, team)
    period_guard = lock_period_state(db, team, month, year)
    assert_period_state_mutable(period_guard, team, month, year)
    assert_period_mutable(db, team, month, year)
    if _current_locked(db, team, month, year):
        raise _error(409, "REPORT_LOCKED", "Báo cáo đã chốt, không thể gửi lại")

    now = _now()
    existing = current_submitted_report(db, team, month, year, lock=True)
    version = (existing.version + 1) if existing else 1
    draft = _current_draft(db, team, month, year, lock=True)
    current_revision = draft.revision if draft is not None else (existing.revision if existing is not None else 0)
    if expected_revision is not None and current_revision != expected_revision:
        raise _error(
            409,
            "VERSION_CONFLICT",
            "Báo cáo đã được cập nhật ở nơi khác",
            {"current_revision": current_revision, "revision": current_revision},
        )
    if existing is not None:
        existing.is_current_version = False
    if draft is not None:
        draft.is_current_version = False

    report = TeamReportModel(
        id=make_id("report"),
        team=team,
        report_month=month,
        report_year=year,
        file_name=f"bao-cao-okr-{team}-T{month}-{year}.xlsx",
        file_path="",
        file_hash="",
        version=version,
        replaced_report_id=existing.id if existing else None,
        is_current_version=True,
        uploaded_by=principal["user_id"],
        uploaded_at=now,
        sheet_name=team,
        validation_status="VALID",
        parsing_status="WEB_INPUT",
        source_type="web_input",
        report_status="submitted",
        submitted_at=now,
        last_auto_save=now,
        assessments=_build_assessments(payload),
        team_level=_monthly_to_team_level(payload.monthly_conclusion, payload.objective_overrides),
        arising_work=[item.model_dump() for item in payload.arising_work],
        source_cell_references=[],
        revision=(current_revision + 1) if expected_revision is not None else 1,
    )
    db.add(report)
    db.flush()
    if existing is not None and existing.source_type != "web_input":
        warning_from_dict(
            db,
            report.id,
            {
                "warning_type": "DATA_SOURCE_CONFLICT",
                "severity": "MEDIUM",
                "source_cell": None,
                "extracted_value": {
                    "previous_report_id": existing.id,
                    "previous_source_type": existing.source_type,
                    "new_source_type": "web_input",
                    "team": team,
                    "month": month,
                    "year": year,
                },
                "reason": "Web input submission replaced an Excel upload for the same team/month/year",
                "admin_action": "PENDING",
            },
        )
    report.file_path = ""
    report.file_hash = ""
    audit(db, principal["user_id"], "TeamReport", report.id, "submit", {"team": team, "month": month, "year": year, "version": version})
    db.commit()
    cache_delete_prefix("okr:dashboard")
    _render_after_content_commit(db, report)
    return report


def lock_report(
    db: Session,
    team: str,
    month: int,
    year: int,
    reason: str,
    principal: dict[str, str],
    assessment_override: str | None = None,
    expected_revision: int | None = None,
    expected_fi_team_revision: int | None = None,
    expected_plan_hash: str | None = None,
) -> TeamReportModel:
    if principal["role"] != Role.ADMIN.value:
        raise _error(403, "FORBIDDEN", "Chỉ Admin được chốt báo cáo")
    assert_period_mutable(db, team, month, year)
    try:
        # D06 lock order: stable team guard -> period row -> FI rows ->
        # report/allocation rows.  The period row is reserved first but is
        # marked locked only after the atomic FI/report mutation succeeds.
        lock_fi_team(db, team)
        period_guard = lock_period_state(db, team, month, year)
        assert_period_state_mutable(period_guard, team, month, year)
        assert_period_mutable(db, team, month, year)
        report = current_submitted_report(db, team, month, year) or _current_draft(db, team, month, year)
        if report is None:
            raise _error(404, "REPORT_NOT_FOUND", "Không tìm thấy báo cáo để chốt")
        # Validate the preliminary snapshot before touching FI rows. The
        # report row itself is intentionally locked only after FI rows have
        # been re-read/finalized, preserving D06's ordering.
        if expected_revision is not None and report.revision != expected_revision:
            db.rollback()
            raise _error(
                409,
                "VERSION_CONFLICT",
                "Báo cáo đã được cập nhật ở nơi khác",
                {"current_revision": report.revision, "revision": report.revision},
            )
        before = model_to_dict(report)
        allocation = finalize_monthly_fi_allocation(
            db,
            report,
            principal["user_id"],
            assessment_override=assessment_override,
            expected_fi_team_revision=expected_fi_team_revision,
            expected_plan_hash=expected_plan_hash,
        )
        report = db.execute(
            select(TeamReportModel)
            .where(TeamReportModel.id == report.id)
            .with_for_update()
        ).scalar_one()
        if expected_revision is not None and report.revision != expected_revision:
            raise _error(
                409,
                "VERSION_CONFLICT",
                "Báo cáo đã được cập nhật ở nơi khác",
                {"current_revision": report.revision, "revision": report.revision},
            )
        report.report_status = "locked"
        report.revision += 1
        report.locked_at = _now()
        report.locked_by = principal["user_id"]
        report.lock_reason = reason
        mark_period_locked(period_guard, principal["user_id"], reason)
        audit(
            db,
            principal["user_id"],
            "TeamReport",
            report.id,
            "lock",
            {
                "before": before,
                "reason": reason,
                "fi_allocation_id": allocation["allocation"]["id"],
                "fi_required_count": allocation["required_count"],
                "fi_selected_sk_ids": allocation["selected_sk_ids"],
            },
        )
        db.commit()
    except FIAllocationError as exc:
        db.rollback()
        status_code = 409 if exc.code in {"FI_ALLOCATION_SHORTAGE", "FI_PREVIEW_STALE"} else 400
        raise _error(status_code, exc.code, str(exc), exc.details) from exc
    except Exception:
        db.rollback()
        raise
    cache_delete_prefix("fi:public_sk")
    cache_delete_prefix("okr:dashboard")
    db.refresh(report)
    return report


def unlock_report(
    db: Session,
    team: str,
    month: int,
    year: int,
    reason: str,
    principal: dict[str, str],
    expected_revision: int | None = None,
) -> TeamReportModel:
    if principal["role"] != Role.ADMIN.value:
        raise _error(403, "FORBIDDEN", "Chỉ Admin được mở chốt báo cáo")
    # Unlock follows the same ordering and re-reads the locked report after
    # both context rows are held. Allocation is locked before the report row.
    lock_fi_team(db, team)
    period_guard = lock_period_state(db, team, month, year)
    if not period_guard.is_locked:
        raise _error(409, "PERIOD_NOT_LOCKED", "Kỳ báo cáo chưa ở trạng thái chốt")
    mark_monthly_fi_allocation_reopened(
        db,
        team=team,
        month=month,
        year=year,
        actor=principal["user_id"],
        reason=reason,
    )
    report = db.execute(
        select(TeamReportModel)
        .where(
            TeamReportModel.team == team,
            TeamReportModel.report_month == month,
            TeamReportModel.report_year == year,
            TeamReportModel.report_status == "locked",
            TeamReportModel.is_current_version.is_(True),
        )
        .with_for_update()
    ).scalar_one_or_none()
    if report is None:
        raise _error(404, "REPORT_NOT_FOUND", "Không tìm thấy báo cáo đã chốt")
    if expected_revision is not None and report.revision != expected_revision:
        raise _error(
            409,
            "VERSION_CONFLICT",
            "Báo cáo đã được cập nhật ở nơi khác",
            {"current_revision": report.revision, "revision": report.revision},
        )
    before = model_to_dict(report)
    report.report_status = "submitted" if report.submitted_at else "draft"
    report.revision += 1
    report.locked_at = None
    report.locked_by = None
    report.lock_reason = None
    mark_period_unlocked(period_guard)
    audit(db, principal["user_id"], "TeamReport", report.id, "unlock", {"before": before, "reason": reason})
    db.commit()
    cache_delete_prefix("okr:dashboard")
    db.refresh(report)
    return report


def preview_fi_allocation(
    db: Session,
    team: str,
    month: int,
    year: int,
    principal: dict[str, str],
    assessment_override: str | None = None,
) -> dict[str, Any]:
    if principal["role"] != Role.ADMIN.value:
        raise _error(403, "FORBIDDEN", "Chỉ Admin được xem trước phân bổ FI")
    report = current_submitted_report(db, team, month, year) or _current_draft(db, team, month, year)
    if report is None:
        raise _error(404, "REPORT_NOT_FOUND", "Không tìm thấy báo cáo để phân bổ FI")
    try:
        return preview_monthly_fi_allocation(db, report, assessment_override=assessment_override)
    except FIAllocationError as exc:
        raise _error(400, exc.code, str(exc), exc.details) from exc


def fi_allocation_for_period(db: Session, team: str, month: int, year: int) -> dict[str, Any] | None:
    return allocation_record_to_dict(allocation_record_for_period(db, team, month, year))


def monthly_fi_admin_overview(
    db: Session,
    month: int,
    year: int,
    principal: dict[str, str],
) -> list[dict[str, Any]]:
    if principal["role"] != Role.ADMIN.value:
        raise _error(403, "FORBIDDEN", "Chỉ Admin được quản lý chốt KHMT và phân bổ FI")

    result: list[dict[str, Any]] = []
    for team in TEAMS:
        report = get_current_input_report(db, team, month, year)
        allocation = allocation_record_for_period(db, team, month, year)
        assessment = str((report.team_level or {}).get("monthly_assessment") or "").strip() if report else ""
        item: dict[str, Any] = {
            "team": team,
            "month": month,
            "year": year,
            "has_report": report is not None,
            "report_id": report.id if report else None,
            "report_version": report.version if report else None,
            "report_revision": report.revision if report else None,
            "report_status": report.report_status if report else None,
            "status": "Chưa nhập" if report is None else DISPLAY_STATUS.get(report.report_status, report.report_status),
            "locked": bool(report and report.report_status == "locked"),
            "assessment": assessment or None,
            "submitted_at": report.submitted_at.isoformat() if report and report.submitted_at else None,
            "allocation": allocation_record_to_dict(allocation),
            "preview_error": None,
            "currently_assigned_count": int(
                db.scalar(
                    select(func.count())
                    .select_from(SKCTKTModel)
                    .where(
                        SKCTKTModel.team == team,
                        SKCTKTModel.khmt_month == month,
                        SKCTKTModel.khmt_year == year,
                        SKCTKTModel.consider_for_khmt.is_(True),
                        SKCTKTModel.is_counted_for_okr.is_(True),
                    )
                )
                or 0
            ),
        }
        if report is not None:
            try:
                preview = preview_monthly_fi_allocation(db, report)
                item.update(
                    {
                        "required_count": preview["required_count"],
                        "available_count": preview["available_count"],
                        "shortage_count": preview["shortage_count"],
                        "currently_assigned_count": preview["currently_assigned_count"],
                        "unassigned_pool_count": preview["unassigned_pool_count"],
                        "can_finalize": preview["can_finalize"],
                    }
                )
            except FIAllocationError as exc:
                item["preview_error"] = {"code": exc.code, "message": str(exc)}
        result.append(item)
    return result


def statuses_for_period(db: Session, month: int, year: int, principal: dict[str, str]) -> list[dict[str, Any]]:
    if principal["role"] == Role.TEAM_ACCOUNT.value:
        principal_team = principal.get("team") or principal["user_id"]
        teams = [principal_team]
    else:
        teams = list(TEAMS)
    result = []
    for team in teams:
        report = get_current_input_report(db, team, month, year)
        result.append(
            {
                "team": team,
                "month": month,
                "year": year,
                "status": "Chưa nhập" if report is None else DISPLAY_STATUS.get(report.report_status, report.report_status),
                "last_saved_at": report.last_auto_save.isoformat() if report and report.last_auto_save else None,
                "submitted_at": report.submitted_at.isoformat() if report and report.submitted_at else None,
                "version": report.version if report else None,
            }
        )
    return result


def preview_for_report(report: TeamReportModel | None, team: str, month: int, year: int) -> dict[str, Any]:
    data = serialize_web_input(report, team, month, year)
    payload = WebInputPayload(**data["data"])
    errors, warnings = validate_web_input_payload(payload, require_complete=True)
    data["validation_errors"] = [item.to_dict() for item in errors]
    data["warnings"] = [item.to_dict() for item in warnings]
    data["summary_counts"] = _summary_counts(report.assessments if report else _build_assessments(payload))
    return data
