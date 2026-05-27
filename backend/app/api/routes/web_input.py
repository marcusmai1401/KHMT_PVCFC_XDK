from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import User
from app.schemas.web_input import LockRequest, WebInputSaveRequest
from app.services.okr.email_report import email_report_path, generate_email_report, write_email_report_file
from app.services.okr.report_template import generate_excel_from_web_input
from app.services.okr.web_input import (
    assert_team_access,
    get_current_input_report,
    lock_report,
    preview_for_report,
    save_draft,
    serialize_web_input,
    statuses_for_period,
    submit_report,
    unlock_report,
)
from app.services.repositories import audit, notify


router = APIRouter(prefix="/okr/web-input", tags=["okr-web-input"])

READ_ROLES = (Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR, Role.TEAM_ACCOUNT, Role.STAFF)
WRITE_ROLES = (Role.ADMIN, Role.TEAM_ACCOUNT)


@router.get("/status")
def web_input_status(
    month: int,
    year: int,
    principal: dict = Depends(require_role(*READ_ROLES)),
    db: Session = Depends(get_db),
):
    return statuses_for_period(db, month, year, principal)


@router.get("/employees")
def list_taggable_employees(
    _: dict = Depends(require_role(*READ_ROLES)),
    db: Session = Depends(get_db),
):
    """Trả về danh sách nhân sự có thể được tag trong phần vi phạm kỷ luật.

    Loại trừ Lãnh đạo Xưởng (WORKSHOP_LEADER) và tài khoản admin hệ thống.
    """
    excluded_roles = {Role.WORKSHOP_LEADER.value, Role.ADMIN.value}
    employees = []
    for user in db.execute(select(User)).scalars():
        if user.role in excluded_roles:
            continue
        if not user.is_active:
            continue
        employees.append({
            "id": user.id,
            "display_name": user.display_name,
            "full_name": user.full_name or user.display_name,
            "team": user.team,
            "role": user.role,
        })
    employees.sort(key=lambda item: (item["team"] or "ZZZ", item["full_name"]))
    return employees


@router.get("/{team}/{month}/{year}")
def get_web_input(
    team: str,
    month: int,
    year: int,
    principal: dict = Depends(require_role(*READ_ROLES)),
    db: Session = Depends(get_db),
):
    assert_team_access(principal, team, write=False)
    report = get_current_input_report(db, team, month, year)
    return serialize_web_input(report, team, month, year)


@router.put("/{team}/{month}/{year}/draft")
def put_web_input_draft(
    team: str,
    month: int,
    year: int,
    payload: WebInputSaveRequest,
    principal: dict = Depends(require_role(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    report = save_draft(db, team, month, year, payload.data, principal, payload.expected_version)
    return serialize_web_input(report, team, month, year)


@router.post("/{team}/{month}/{year}/submit")
def post_web_input_submit(
    team: str,
    month: int,
    year: int,
    payload: WebInputSaveRequest,
    principal: dict = Depends(require_role(*WRITE_ROLES)),
    db: Session = Depends(get_db),
):
    report = submit_report(db, team, month, year, payload.data, principal)
    notify(
        db,
        "OKR_TEAM_SUBMITTED",
        {
            "report_id": report.id,
            "team": team,
            "month": month,
            "year": year,
            "submitted_by": principal["user_id"],
            "display_name": principal.get("display_name"),
        },
        recipient_role=Role.WORKSHOP_LEADER.value,
    )
    db.commit()
    return serialize_web_input(report, team, month, year)


@router.post("/{team}/{month}/{year}/lock")
def post_web_input_lock(
    team: str,
    month: int,
    year: int,
    payload: LockRequest,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    report = lock_report(db, team, month, year, payload.reason, principal)
    return serialize_web_input(report, team, month, year)


@router.post("/{team}/{month}/{year}/unlock")
def post_web_input_unlock(
    team: str,
    month: int,
    year: int,
    payload: LockRequest,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    report = unlock_report(db, team, month, year, payload.reason, principal)
    return serialize_web_input(report, team, month, year)


@router.get("/{team}/{month}/{year}/preview")
def get_web_input_preview(
    team: str,
    month: int,
    year: int,
    principal: dict = Depends(require_role(*READ_ROLES)),
    db: Session = Depends(get_db),
):
    assert_team_access(principal, team, write=False)
    report = get_current_input_report(db, team, month, year)
    return preview_for_report(report, team, month, year)


@router.get("/{team}/{month}/{year}/export/excel")
def export_web_input_excel(
    team: str,
    month: int,
    year: int,
    principal: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    assert_team_access(principal, team, write=False)
    report = get_current_input_report(db, team, month, year)
    if report is None:
        from app.services.okr.web_input import _error

        raise _error(404, "REPORT_NOT_FOUND", "Không tìm thấy báo cáo")
    path = Path(report.file_path) if report.file_path else generate_excel_from_web_input(report)
    if not path.exists():
        path = generate_excel_from_web_input(report)
    audit(db, principal["user_id"], "TeamReport", report.id, "export_excel", {"team": team, "month": month, "year": year})
    db.commit()
    return FileResponse(path, filename=path.name)


@router.get("/{team}/{month}/{year}/export/email")
def export_web_input_email(
    team: str,
    month: int,
    year: int,
    principal: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    assert_team_access(principal, team, write=False)
    report = get_current_input_report(db, team, month, year)
    if report is None:
        from app.services.okr.web_input import _error

        raise _error(404, "REPORT_NOT_FOUND", "Không tìm thấy báo cáo")
    audit(db, principal["user_id"], "TeamReport", report.id, "export_email", {"team": team, "month": month, "year": year})
    db.commit()
    return {"text": generate_email_report(report), "filename": email_report_path(report).name}


@router.get("/{team}/{month}/{year}/export/email/download")
def download_web_input_email(
    team: str,
    month: int,
    year: int,
    principal: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    assert_team_access(principal, team, write=False)
    report = get_current_input_report(db, team, month, year)
    if report is None:
        from app.services.okr.web_input import _error

        raise _error(404, "REPORT_NOT_FOUND", "Không tìm thấy báo cáo")
    path = write_email_report_file(report)
    audit(db, principal["user_id"], "TeamReport", report.id, "download_email", {"team": team, "month": month, "year": year})
    db.commit()
    return PlainTextResponse(
        path.read_text(encoding="utf-8"),
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )
