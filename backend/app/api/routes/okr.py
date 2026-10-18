from app.services.repositories import public_report_dict
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import tempfile
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import HistoricalSnapshotModel, KRMappingModel, SystemConfigModel, TeamHeadcountModel, TeamReportModel, WarningModel
from app.schemas.common import LeaderKPIAllocationUpdate, WarningResolveRequest
from app.services.cache import cache_delete_prefix, cache_get, cache_set
from app.services.fi.period_guard import assert_period_mutable
from app.services.fi.service import count_for_okr, fi_dashboard
from app.services.okr.constants import TEAM_DISPLAY_NAMES, TEAMS
from app.services.okr.dashboard import build_dashboard_view, export_dashboard_workbook
from app.services.okr.historical_snapshot import import_historical_snapshot, snapshots_to_dicts
from app.services.okr.kpi_rules import kpi_rule_periods
from app.services.okr.period_resolver import find_latest_data_period, find_workbook_period, resolve_default_period
from app.services.okr.report_template import TEMPLATE_FILENAME, generate_standard_report_template
from app.services.okr.workbook import identify_month, identify_team, identify_year, parse_team_report
from app.services.repositories import audit, current_report_for, make_id, model_to_dict, warning_from_dict

router = APIRouter(prefix="/okr", tags=["okr"])

REFERENCE_VIEW_ROLES = (Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR, Role.TEAM_ACCOUNT, Role.STAFF)


def _safe_filename(filename: str | None) -> str:
    name = Path(filename or "report.xlsx").name
    return "".join(ch for ch in name if ch.isalnum() or ch in {" ", ".", "_", "-"}) or "report.xlsx"


def _truncate_for_log(value: Any, limit: int = 2000) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else f"{text[:limit]}..."


TELEMETRY_STRING_FIELDS = {
    "event_name",
    "route_template",
    "module",
    "error_code",
    "request_id",
    "build_id",
    "environment",
}
TELEMETRY_NUMBER_FIELDS = {"duration_ms", "http_status"}
TELEMETRY_OPTIONAL_FIELDS = TELEMETRY_STRING_FIELDS | TELEMETRY_NUMBER_FIELDS | {"role"}


def _allowlisted_telemetry(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep client telemetry useful without accepting user/content payloads."""
    raw = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    result: dict[str, Any] = {}
    for field in TELEMETRY_STRING_FIELDS:
        value = raw.get(field)
        if value in (None, ""):
            continue
        text = str(value).strip()[:160]
        # Route templates must not smuggle query strings, identifiers, or paths.
        if field == "route_template" and ("?" in text or "\\" in text):
            continue
        result[field] = text
    for field in TELEMETRY_NUMBER_FIELDS:
        value = raw.get(field)
        if isinstance(value, bool):
            continue
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue
        if field == "duration_ms":
            result[field] = max(0, min(number, 86_400_000))
        else:
            result[field] = max(100, min(number, 599))
    role = raw.get("role")
    if role in {role_value.value for role_value in Role}:
        result["role"] = role
    return result


def _current_reports(
    db: Session,
    *,
    month: int | None = None,
    year: int | None = None,
) -> list[dict[str, Any]]:
    conditions = [
        TeamReportModel.is_current_version.is_(True),
        TeamReportModel.report_status.in_(["submitted", "locked"]),
    ]
    if month is not None:
        conditions.append(TeamReportModel.report_month == month)
    if year is not None:
        conditions.append(TeamReportModel.report_year == year)
    reports = db.execute(select(TeamReportModel).where(*conditions)).scalars().all()
    return [public_report_dict(report) for report in reports]


def _mapping_records(db: Session) -> list[dict[str, Any]]:
    return [model_to_dict(record) for record in db.execute(select(KRMappingModel).order_by(KRMappingModel.dashboard_column)).scalars()]


def _headcount_map(db: Session, month: int, year: int) -> dict[str, dict[str, Any]]:
    records = db.execute(select(TeamHeadcountModel)).scalars().all()
    selected: dict[str, TeamHeadcountModel] = {}
    for record in records:
        if record.effective_year > year or (
            record.effective_year == year and record.effective_month > month
        ):
            continue
        current = selected.get(record.team)
        if current is None or (record.effective_year, record.effective_month) > (
            current.effective_year,
            current.effective_month,
        ):
            selected[record.team] = record
    return {
        team: {
            "total_headcount": record.total_headcount,
            "vhdn_eligible_headcount": record.vhdn_eligible_headcount,
            "effective_month": record.effective_month,
            "effective_year": record.effective_year,
            "notes": record.notes,
        }
        for team, record in selected.items()
    }


def _infer_period_from_reports(reports: list[dict[str, Any]]) -> tuple[int, int] | None:
    for report in reports:
        month = report.get("report_month")
        year = report.get("report_year")
        if month and year:
            return int(month), int(year)
    return None


def _period_filter(periods: list[tuple[int, int]]):
    return or_(
        *(
            and_(TeamReportModel.report_month == period_month, TeamReportModel.report_year == period_year)
            for period_month, period_year in periods
        )
    )


def _deadline_day(db: Session) -> int:
    record = db.get(SystemConfigModel, "submission_deadline_day")
    return int(record.value if record else 25)


def _manual_leader_kpi_key(month: int, year: int) -> str:
    return f"leader_kpi_manual_allocations:{year}:{month}"


def _nullable_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _manual_leader_kpi_allocations(db: Session, month: int, year: int) -> dict[str, dict[str, Any]]:
    record = db.get(SystemConfigModel, _manual_leader_kpi_key(month, year))
    raw = record.value if record and isinstance(record.value, dict) else {}
    rows: dict[str, dict[str, Any]] = {}
    for team in TEAMS:
        value = raw.get(team) if isinstance(raw.get(team), dict) else {}
        rows[team] = {
            "team": team,
            "team_name": TEAM_DISPLAY_NAMES[team],
            "a1": _nullable_int(value.get("a1")),
            "a2": _nullable_int(value.get("a2")),
            "updated_at": value.get("updated_at"),
            "updated_by": value.get("updated_by"),
        }
    return rows


def _apply_manual_leader_kpi_allocations(data: dict[str, Any], manual_rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    visible_teams = [row.get("team") for row in data.get("teams", []) if row.get("team") in TEAMS]
    for row in data.get("teams", []):
        team = row.get("team")
        if team in manual_rows:
            row["leader_kpi_manual_allocation"] = manual_rows[team]
    data["manual_leader_kpi_allocations"] = [manual_rows[team] for team in visible_teams if team in manual_rows]
    data["manual_kpi_allocation_summary"] = {
        "A1": sum(int(manual_rows[team].get("a1") or 0) for team in visible_teams if team in manual_rows),
        "A2": sum(int(manual_rows[team].get("a2") or 0) for team in visible_teams if team in manual_rows),
    }
    return data


def _late_warning_if_needed(db: Session, report: TeamReportModel) -> None:
    if report.uploaded_at.day > _deadline_day(db):
        warning_from_dict(
            db,
            report.id,
            {
                "warning_type": "LATE_SUBMISSION",
                "severity": "LOW",
                "source_cell": None,
                "extracted_value": {"uploaded_at": report.uploaded_at.isoformat()},
                "reason": "Team report was uploaded after the configured monthly deadline",
                "admin_action": "PENDING",
            },
        )


def _sk_count_mismatch_warnings(db: Session, report: TeamReportModel) -> None:
    if report.team is None or report.report_month is None or report.report_year is None:
        return
    fi_count = count_for_okr(db, report.report_month, report.report_year).get(report.team, 0)
    reported = None
    for assessment in report.assessments:
        if assessment.get("workshop_kr_code") != "O5.KR13":
            continue
        for metric in assessment.get("metrics", []):
            if metric.get("actual") is not None:
                reported = max(int(metric["actual"]), reported or 0)
    if reported is not None and reported != fi_count:
        warning_from_dict(
            db,
            report.id,
            {
                "warning_type": "SK_CTKT_COUNT_MISMATCH",
                "severity": "MEDIUM",
                "source_cell": None,
                "extracted_value": {"reported": reported, "fi_count": fi_count, "team": report.team},
                "reason": f"Team report SK-CTKT count {reported} does not match FI records {fi_count}",
                "admin_action": "PENDING",
            },
        )


@router.post("/client-debug-log")
def client_debug_log(payload: dict[str, Any], principal: dict = Depends(require_role(*REFERENCE_VIEW_ROLES))):
    telemetry = _allowlisted_telemetry(payload)
    telemetry.setdefault("environment", settings.environment)
    telemetry.setdefault("role", principal["role"])
    print(
        "[client-telemetry] "
        f"data={_truncate_for_log(telemetry, limit=1200)}",
        flush=True,
    )
    return {"ok": True, "accepted_fields": sorted(telemetry)}


@router.post("/reports/upload")
def upload_report(
    file: UploadFile = File(...),
    team: str | None = Form(default=None),
    month: int | None = Form(default=None),
    year: int | None = Form(default=None),
    mode: Literal["preview", "insert-missing", "replace"] = Form(default="insert-missing"),
    confirm_replace: bool = Form(default=False),
    expected_revision: int | None = Form(default=None),
    preview_token: str | None = Form(default=None),
    replace_reason: str | None = Form(default=None),
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_FILE_TYPE", "message": "Only .xlsx files are supported"})
    if file.content_type and file.content_type not in {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_CONTENT_TYPE", "message": "Only Excel workbook uploads are supported"})
    data = file.file.read(settings.max_excel_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_excel_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail={"error_code": "FILE_TOO_LARGE", "message": "Excel file is too large"})
    upload_dir = settings.storage_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_hash = hashlib.sha256(data).hexdigest()
    safe_name = _safe_filename(file.filename)
    # Parse from a short-lived file first.  A preview, rejected replacement,
    # or invalid workbook must not create a referenced-looking artifact.
    temp_path: Path | None = None
    temp_handle, temp_name = tempfile.mkstemp(prefix=".report-preview-", suffix=".xlsx", dir=upload_dir)
    try:
        temp_path = Path(temp_name)
        with open(temp_handle, "wb", closefd=True) as handle:
            handle.write(data)
    except OSError as exc:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail={"error_code": "FILE_STAGE_FAILED", "message": "Không thể tiếp nhận file báo cáo"}) from exc
    source_team = team or identify_team(safe_name)
    source_month = month or identify_month(safe_name)
    source_year = year or identify_year(safe_name)
    try:
        parsed = parse_team_report(temp_path, team=source_team, month=source_month, year=source_year)
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"error_code": "TEMPLATE_MISMATCH", "message": str(exc)}) from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    existing = current_report_for(db, parsed.get("team"), parsed.get("report_month"), parsed.get("report_year"))
    identity = {
        "file_hash": file_hash,
        "team": parsed.get("team"),
        "month": parsed.get("report_month"),
        "year": parsed.get("report_year"),
        "existing_report_id": existing.id if existing else None,
        "existing_revision": existing.revision if existing else 0,
    }
    expected_preview_token = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if mode == "preview":
        action = "insert"
        if existing is not None:
            action = "skip" if existing.file_hash == file_hash else "replace"
        return {
            "mode": "preview",
            "action": action,
            "source_file_hash": file_hash,
            "preview_token": expected_preview_token,
            "team": parsed.get("team"),
            "month": parsed.get("report_month"),
            "year": parsed.get("report_year"),
            "existing_report": model_to_dict(existing) if existing else None,
            "warnings": parsed.get("warnings", []),
        }
    if mode == "insert-missing" and existing is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "DUPLICATE_FILE",
                "message": "Đã có báo cáo cho đội/kỳ này; dữ liệu hiện tại được giữ nguyên.",
                "action": "skipped",
                "source_file_hash": file_hash,
                "existing_report_id": existing.id,
            },
        )
    if mode in {"insert-missing", "replace"} and parsed.get("team") and parsed.get("report_month") and parsed.get("report_year"):
        assert_period_mutable(
            db,
            parsed["team"],
            int(parsed["report_month"]),
            int(parsed["report_year"]),
        )
    if mode == "replace":
        if not confirm_replace:
            raise HTTPException(status_code=409, detail={"error_code": "REPLACE_CONFIRMATION_REQUIRED", "message": "Cần xác nhận thay thế báo cáo sau khi xem preview."})
        if not preview_token or preview_token != expected_preview_token:
            raise HTTPException(status_code=409, detail={"error_code": "STALE_IMPORT_PREVIEW", "message": "Preview file đã cũ hoặc không khớp nguồn hiện tại; hãy preview lại."})
        if existing is not None and expected_revision is None:
            raise HTTPException(status_code=428, detail={"error_code": "CLIENT_UPDATE_REQUIRED", "message": "Thay thế báo cáo yêu cầu client mới có expected_revision."})
        if existing is not None and existing.revision != expected_revision:
            raise HTTPException(
                status_code=409,
                detail={
                    "error_code": "VERSION_CONFLICT",
                    "message": "Báo cáo đã thay đổi; hãy preview lại trước khi thay thế.",
                    "current_revision": existing.revision,
                },
            )
        if not (replace_reason or "").strip():
            raise HTTPException(status_code=422, detail={"error_code": "REPLACEMENT_REASON_REQUIRED", "message": "Cần ghi lý do thay thế báo cáo."})
    version = 1
    replaced_report_id = None
    if existing is not None:
        existing.is_current_version = False
        version = existing.version + 1
        replaced_report_id = existing.id

    target = upload_dir / f"{make_id('report-file')}-{safe_name}"
    target.write_bytes(data)
    report = TeamReportModel(
        id=make_id("report"),
        file_name=safe_name,
        file_path=str(target),
        file_hash=file_hash,
        version=version,
        replaced_report_id=replaced_report_id,
        is_current_version=True,
        uploaded_by=principal["user_id"],
        uploaded_at=datetime.now(timezone.utc),
        team=parsed.get("team"),
        report_month=parsed.get("report_month"),
        report_year=parsed.get("report_year"),
        sheet_name=parsed.get("sheet_name"),
        assessments=parsed.get("assessments", []),
        team_level=parsed.get("team_level", {}),
        source_cell_references=parsed.get("source_cell_references", []),
        team_month_assigned_manually=bool(team or month or year),
        source_type="excel_upload",
        report_status="submitted",
        submitted_at=datetime.now(timezone.utc),
        revision=(existing.revision + 1) if existing is not None else 1,
    )
    db.add(report)
    db.flush()
    for warning in parsed.get("warnings", []):
        warning_from_dict(db, report.id, warning)
    _late_warning_if_needed(db, report)
    _sk_count_mismatch_warnings(db, report)
    if existing is not None and existing.source_type != "excel_upload":
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
                    "new_source_type": "excel_upload",
                    "team": report.team,
                    "month": report.report_month,
                    "year": report.report_year,
                },
                "reason": "Excel upload replaced a web input submission for the same team/month/year",
                "admin_action": "PENDING",
            },
        )
    audit(db, principal["user_id"], "TeamReport", report.id, "upload", {"file_name": safe_name, "version": version, "mode": mode, "reason": replace_reason})
    try:
        db.commit()
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        raise
    cache_delete_prefix("okr:dashboard")
    db.refresh(report)
    return public_report_dict(report)


@router.get("/reports")
def list_reports(_: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    reports = db.execute(
        select(TeamReportModel)
        .where(TeamReportModel.report_status.in_(["submitted", "locked"]))
        .order_by(TeamReportModel.uploaded_at.desc())
    ).scalars().all()
    return [public_report_dict(report) for report in reports]


@router.get("/reports/template")
def report_template(_: dict = Depends(require_role(*REFERENCE_VIEW_ROLES)), db: Session = Depends(get_db)):
    path = generate_standard_report_template(_mapping_records(db))
    return FileResponse(path, filename=TEMPLATE_FILENAME)


@router.get("/kr-mapping")
def public_kr_mapping(_: dict = Depends(require_role(*REFERENCE_VIEW_ROLES)), db: Session = Depends(get_db)):
    return _mapping_records(db)


@router.get("/reports/{report_id}/preview")
def preview_report(report_id: str, _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    report = db.get(TeamReportModel, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.report_status not in {"submitted", "locked"}:
        raise HTTPException(status_code=403, detail="Draft reports are only visible in the team input workspace")
    return public_report_dict(report)


@router.get("/warnings")
def list_warnings(
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2000, le=2100),
    current_only: bool = True,
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    statement = select(WarningModel)
    if current_only or month is not None or year is not None:
        statement = statement.join(TeamReportModel, WarningModel.team_report_id == TeamReportModel.id)
        if current_only:
            statement = statement.where(
                TeamReportModel.is_current_version.is_(True),
                TeamReportModel.report_status.in_(["submitted", "locked"]),
            )
        if month is not None:
            statement = statement.where(TeamReportModel.report_month == month)
        if year is not None:
            statement = statement.where(TeamReportModel.report_year == year)
    warnings = db.execute(statement.order_by(WarningModel.created_at.desc())).scalars().all()
    return [model_to_dict(warning) for warning in warnings]


@router.put("/warnings/{warning_id}/resolve")
def resolve_warning(
    warning_id: str,
    payload: WarningResolveRequest,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    warning = db.get(WarningModel, warning_id)
    if warning is None:
        raise HTTPException(status_code=404, detail="Warning not found")
    before = model_to_dict(warning)
    warning.admin_action = payload.admin_action
    warning.admin_notes = payload.admin_notes
    warning.adjusted_value = payload.adjusted_value
    warning.resolved_at = datetime.now(timezone.utc)
    warning.resolved_by = principal["user_id"]
    audit(db, principal["user_id"], "Warning", warning_id, "resolve", {"before": before, "after": model_to_dict(warning)})
    db.commit()
    db.refresh(warning)
    return model_to_dict(warning)


def _dashboard_payload(month: int, year: int, principal: dict, db: Session) -> dict[str, Any]:
    namespace = "sandbox" if principal.get("sandbox") else "prod"
    cache_key = f"okr:dashboard:v3:{namespace}:{month}:{year}:{principal['role']}:{principal['user_id']}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    reports = [
        public_report_dict(report)
        for report in db.execute(
            select(TeamReportModel).where(
                TeamReportModel.is_current_version.is_(True),
                TeamReportModel.report_status.in_(["submitted", "locked"]),
                or_(TeamReportModel.report_month == month, TeamReportModel.report_month.is_(None)),
                or_(TeamReportModel.report_year == year, TeamReportModel.report_year.is_(None)),
            )
        ).scalars()
    ]
    history_reports = [
        public_report_dict(report)
        for report in db.execute(
            select(TeamReportModel).where(
                TeamReportModel.is_current_version.is_(True),
                TeamReportModel.report_status.in_(["submitted", "locked"]),
                TeamReportModel.report_year == year,
                TeamReportModel.report_month >= 1,
                TeamReportModel.report_month <= 12,
            )
        ).scalars()
    ]
    matrix_history_reports = [
        public_report_dict(report)
        for report in db.execute(
            select(TeamReportModel).where(
                TeamReportModel.is_current_version.is_(True),
                TeamReportModel.report_status.in_(["submitted", "locked"]),
                _period_filter(kpi_rule_periods(month, year)),
            )
        ).scalars()
    ]
    snapshots = snapshots_to_dicts(
        list(
            db.execute(
                select(HistoricalSnapshotModel).where(
                    HistoricalSnapshotModel.year == year,
                    or_(HistoricalSnapshotModel.month == 0, HistoricalSnapshotModel.month.between(1, 12)),
                )
            ).scalars()
        )
    )
    data = build_dashboard_view(
        month,
        year,
        reports,
        _mapping_records(db),
        history_reports=history_reports,
        matrix_history_reports=matrix_history_reports,
        historical_snapshots=snapshots,
        headcounts=_headcount_map(db, month, year),
        fi_counts_by_team=count_for_okr(db, month, year),
        fi_dashboard_summary=fi_dashboard(db, principal),
        principal=principal,
    )
    data = _apply_manual_leader_kpi_allocations(data, _manual_leader_kpi_allocations(db, month, year))
    ttl = min(int(settings.dashboard_cache_ttl_seconds), 300)
    cache_set(cache_key, data, ttl)
    return data


@router.put("/leader-kpi-allocation/{month}/{year}/{team}")
def update_leader_kpi_allocation(
    month: int,
    year: int,
    team: str,
    payload: LeaderKPIAllocationUpdate,
    principal: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    if team not in TEAMS:
        raise HTTPException(status_code=404, detail="Không tìm thấy đội/tổ")
    key = _manual_leader_kpi_key(month, year)
    record = db.get(SystemConfigModel, key)
    current = dict(record.value) if record and isinstance(record.value, dict) else {}
    current[team] = {
        "a1": payload.a1,
        "a2": payload.a2,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": principal["user_id"],
    }
    if record is None:
        record = SystemConfigModel(key=key, value=current, updated_by=principal["user_id"])
        db.add(record)
    else:
        record.value = current
        record.updated_by = principal["user_id"]
    audit(db, principal["user_id"], "LeaderKPIAllocation", f"{year}-{month}:{team}", "upsert", current[team])
    db.commit()
    cache_delete_prefix("okr:dashboard")
    return _dashboard_payload(month, year, principal, db)


@router.get("/dashboard/latest")
def dashboard_latest(
    last_selected_month: int | None = None,
    last_selected_year: int | None = None,
    principal: dict = Depends(require_role(*REFERENCE_VIEW_ROLES)),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    resolved = resolve_default_period(
        last_selected=(last_selected_month, last_selected_year) if last_selected_month and last_selected_year else None,
        latest_data=find_latest_data_period(db),
        workbook=find_workbook_period(db),
        today=(now.month, now.year),
    )
    data = _dashboard_payload(resolved.month, resolved.year, principal, db)
    return {
        **data,
        "period": {
            **(data.get("period") or {}),
            "month": resolved.month,
            "year": resolved.year,
            "label": resolved.label,
            "source": resolved.source,
        },
    }


@router.get("/dashboard/{month}/{year}")
def dashboard(
    month: int,
    year: int,
    principal: dict = Depends(require_role(*REFERENCE_VIEW_ROLES)),
    db: Session = Depends(get_db),
):
    return _dashboard_payload(month, year, principal, db)


@router.post("/dashboard/export")
def export_dashboard(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020, le=2100),
    _: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    # The period is part of the contract.  This prevents a stale or unrelated
    # current report from silently becoming the export source.
    reports = _current_reports(db, month=month, year=year)
    fi_counts = count_for_okr(db, month, year)
    export_id = make_id("okr-export")
    path = settings.storage_dir / "exports" / f"okr-dashboard-{year}-{month:02d}-{export_id}.xlsx"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path = export_dashboard_workbook(reports, output_path=path, fi_counts_by_team=fi_counts)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return FileResponse(
        path,
        filename=f"okr-dashboard-T{month}-{year}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.post("/historical-snapshots/import")
def import_snapshot(
    file: UploadFile = File(...),
    mode: Literal["preview", "insert-missing"] = Query(default="preview"),
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_FILE_TYPE", "message": "Only .xlsx files are supported"})
    if file.content_type and file.content_type not in {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_CONTENT_TYPE", "message": "Only Excel workbook uploads are supported"})
    data = file.file.read(settings.max_excel_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_excel_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail={"error_code": "FILE_TOO_LARGE", "message": "Excel file is too large"})
    try:
        result = import_historical_snapshot(
            db,
            data,
            source_file_name=_safe_filename(file.filename),
            imported_by=principal["user_id"],
            mode=mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_WORKBOOK", "message": str(exc)}) from exc
    if mode == "preview":
        db.rollback()
        result["mode"] = "preview"
    else:
        audit(db, principal["user_id"], "HistoricalSnapshot", result["source_file_hash"], "import", result)
        db.commit()
        cache_delete_prefix("okr:dashboard")
        result["mode"] = "insert-missing"
    return result


@router.get("/history")
def history(_: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    return list_reports(_, db)


@router.get("/evaluation/criteria")
def evaluation_criteria(_: dict = Depends(require_role(*REFERENCE_VIEW_ROLES))):
    from app.services.okr.evaluation_reference import load_evaluation_criteria

    return load_evaluation_criteria()


@router.get("/evaluation/principles")
def evaluation_principles(_: dict = Depends(require_role(*REFERENCE_VIEW_ROLES))):
    from app.services.okr.evaluation_reference import load_evaluation_principles

    return load_evaluation_principles()
