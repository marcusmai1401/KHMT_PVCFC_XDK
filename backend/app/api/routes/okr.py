from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
from typing import Any

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
from app.services.fi.service import count_for_okr, fi_dashboard
from app.services.okr.constants import TEAM_DISPLAY_NAMES, TEAMS
from app.services.okr.dashboard import build_dashboard_view, export_dashboard_workbook
from app.services.okr.historical_snapshot import import_historical_snapshot, snapshots_to_dicts
from app.services.okr.kpi_rules import kpi_rule_periods
from app.services.okr.period_resolver import find_latest_data_period, find_workbook_period, resolve_default_period
from app.services.okr.report_template import TEMPLATE_FILENAME, generate_standard_report_template
from app.services.okr.workbook import parse_team_report
from app.services.repositories import audit, current_report_for, make_id, model_to_dict, warning_from_dict

router = APIRouter(prefix="/okr", tags=["okr"])

REFERENCE_VIEW_ROLES = (Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR, Role.TEAM_ACCOUNT, Role.STAFF)


def _safe_filename(filename: str | None) -> str:
    name = Path(filename or "report.xlsx").name
    return "".join(ch for ch in name if ch.isalnum() or ch in {" ", ".", "_", "-"}) or "report.xlsx"


def _truncate_for_log(value: Any, limit: int = 2000) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else f"{text[:limit]}..."


def _current_reports(db: Session) -> list[dict[str, Any]]:
    reports = db.execute(
        select(TeamReportModel).where(
            TeamReportModel.is_current_version.is_(True),
            TeamReportModel.report_status.in_(["submitted", "locked"]),
        )
    ).scalars().all()
    return [model_to_dict(report) for report in reports]


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
    source = str(payload.get("source") or "frontend")[:80]
    event = str(payload.get("event") or "debug")[:80]
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    message = str(payload.get("message") or "")[:500]
    print(
        "[client-debug] "
        f"user={principal['user_id']} role={principal['role']} source={source} event={event} "
        f"message={message} data={_truncate_for_log(data)}",
        flush=True,
    )
    return {"ok": True}


@router.post("/reports/upload")
async def upload_report(
    file: UploadFile = File(...),
    team: str | None = Form(default=None),
    month: int | None = Form(default=None),
    year: int | None = Form(default=None),
    confirm_replace: bool = Form(default=False),
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
    data = await file.read()
    if len(data) > settings.max_excel_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail={"error_code": "FILE_TOO_LARGE", "message": "Excel file is too large"})
    upload_dir = settings.storage_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_hash = hashlib.sha256(data).hexdigest()
    safe_name = _safe_filename(file.filename)
    target = upload_dir / f"{file_hash}-{safe_name}"
    target.write_bytes(data)
    try:
        parsed = parse_team_report(target, team=team, month=month, year=year)
    except Exception as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail={"error_code": "TEMPLATE_MISMATCH", "message": str(exc)}) from exc

    existing = current_report_for(db, parsed.get("team"), parsed.get("report_month"), parsed.get("report_year"))
    if existing is not None and not confirm_replace:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "DUPLICATE_FILE",
                "existing_report_id": existing.id,
                "team": existing.team,
                "month": existing.report_month,
                "year": existing.report_year,
            },
        )
    version = 1
    replaced_report_id = None
    if existing is not None:
        existing.is_current_version = False
        version = existing.version + 1
        replaced_report_id = existing.id

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
    audit(db, principal["user_id"], "TeamReport", report.id, "upload", {"file_name": safe_name, "version": version})
    db.commit()
    cache_delete_prefix("okr:dashboard")
    db.refresh(report)
    return model_to_dict(report)


@router.get("/reports")
def list_reports(_: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    reports = db.execute(
        select(TeamReportModel)
        .where(TeamReportModel.report_status.in_(["submitted", "locked"]))
        .order_by(TeamReportModel.uploaded_at.desc())
    ).scalars().all()
    return [model_to_dict(report) for report in reports]


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
    return model_to_dict(report)


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
        model_to_dict(report)
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
        model_to_dict(report)
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
        model_to_dict(report)
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
def export_dashboard(_: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    reports = _current_reports(db)
    period = _infer_period_from_reports(reports)
    fi_counts = count_for_okr(db, *period) if period else None
    path = export_dashboard_workbook(reports, fi_counts_by_team=fi_counts)
    return FileResponse(path, filename=Path(path).name)


@router.post("/historical-snapshots/import")
async def import_snapshot(
    file: UploadFile = File(...),
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
    data = await file.read()
    if len(data) > settings.max_excel_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail={"error_code": "FILE_TOO_LARGE", "message": "Excel file is too large"})
    try:
        result = import_historical_snapshot(
            db,
            data,
            source_file_name=_safe_filename(file.filename),
            imported_by=principal["user_id"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error_code": "INVALID_WORKBOOK", "message": str(exc)}) from exc
    audit(db, principal["user_id"], "HistoricalSnapshot", result["source_file_hash"], "import", result)
    db.commit()
    cache_delete_prefix("okr:dashboard")
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
