from __future__ import annotations

from pathlib import Path
import hashlib
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.et_domain import Personnel
from app.schemas.et_schemas import (
    AssessmentCreate,
    AssessmentUpdate,
    FrameworkCreate,
    FrameworkItemCreate,
    FrameworkItemUpdate,
    FrameworkUpdate,
    ItemReorderRequest,
    LearningPlanAutoGenerateRequest,
    LearningPlanCompleteRequest,
    LearningPlanCreate,
    LearningPlanUpdate,
    PersonnelBulkLevelUpdate,
    PersonnelCreate,
    PersonnelUpdate,
)
from app.services import et_excel_service, et_service
from app.services.et_service import ETValidationError


router = APIRouter(prefix="/et", tags=["et"])


def _handle_error(exc: ETValidationError) -> HTTPException:
    detail: Any = exc.message
    if exc.errors:
        detail = {"message": exc.message, "errors": exc.errors}
    return HTTPException(status_code=exc.status_code, detail=detail)


def _safe_filename(filename: str | None) -> str:
    name = Path(filename or "upload.xlsx").name
    return "".join(ch for ch in name if ch.isalnum() or ch in {" ", ".", "_", "-"}) or "upload.xlsx"


async def _save_upload(file: UploadFile) -> Path:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")
    data = await file.read()
    if len(data) > settings.max_excel_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Excel file is too large")
    upload_dir = settings.storage_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(data).hexdigest()
    path = upload_dir / f"{digest}-{_safe_filename(file.filename)}"
    path.write_bytes(data)
    return path


def _commit_or_rollback(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


@router.get("/frameworks")
def list_frameworks(
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    return [et_service.serialize_framework(framework) for framework in et_service.list_frameworks(db)]


@router.post("/frameworks")
def create_framework(
    payload: FrameworkCreate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        framework = et_service.create_framework(db, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_framework(framework, include_items=True)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/frameworks/{framework_id}")
def get_framework(
    framework_id: str,
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    try:
        return et_service.serialize_framework(et_service.get_framework(db, framework_id), include_items=True)
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.put("/frameworks/{framework_id}")
def update_framework(
    framework_id: str,
    payload: FrameworkUpdate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        framework = et_service.update_framework(db, framework_id, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_framework(framework, include_items=True)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.delete("/frameworks/{framework_id}")
def delete_framework(
    framework_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        et_service.delete_framework(db, framework_id, principal["user_id"])
        _commit_or_rollback(db)
        return {"status": "deleted"}
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.post("/frameworks/{framework_id}/duplicate")
def duplicate_framework(
    framework_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        framework = et_service.duplicate_framework(db, framework_id, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_framework(framework, include_items=True)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.post("/frameworks/{framework_id}/activate")
def activate_framework(
    framework_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        framework = et_service.activate_framework(db, framework_id, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_framework(framework, include_items=True)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/frameworks/{framework_id}/export")
def export_framework(
    framework_id: str,
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    try:
        path = et_excel_service.export_framework_to_excel(et_service.get_framework(db, framework_id))
        return FileResponse(path, filename=Path(path).name)
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.get("/frameworks/{framework_id}/items")
def list_framework_items(
    framework_id: str,
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    try:
        return [et_service.serialize_item(item) for item in et_service.get_framework(db, framework_id).items]
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.post("/frameworks/{framework_id}/items")
def add_framework_item(
    framework_id: str,
    payload: FrameworkItemCreate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        item = et_service.add_framework_item(db, framework_id, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_item(item)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.put("/frameworks/{framework_id}/items/reorder")
def reorder_framework_items(
    framework_id: str,
    payload: ItemReorderRequest,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        items = et_service.reorder_framework_items(db, framework_id, payload.orders, principal["user_id"])
        _commit_or_rollback(db)
        return [et_service.serialize_item(item) for item in items]
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.put("/frameworks/{framework_id}/items/{item_id}")
def update_framework_item(
    framework_id: str,
    item_id: str,
    payload: FrameworkItemUpdate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        item = et_service.update_framework_item(db, framework_id, item_id, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_item(item)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.delete("/frameworks/{framework_id}/items/{item_id}")
def delete_framework_item(
    framework_id: str,
    item_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        et_service.delete_framework_item(db, framework_id, item_id, principal["user_id"])
        _commit_or_rollback(db)
        return {"status": "deleted"}
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.post("/frameworks/import")
async def import_frameworks(
    file: UploadFile = File(...),
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    path = await _save_upload(file)
    try:
        frameworks = et_excel_service.import_frameworks_from_excel(db, path, principal["user_id"])
        _commit_or_rollback(db)
        return {"created": [et_service.serialize_framework(framework, include_items=True) for framework in frameworks]}
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/personnel/summary")
def get_personnel_summary(
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    return et_service.personnel_summary(db)


@router.get("/personnel")
def list_personnel(
    team: str | None = None,
    position: str | None = None,
    level: int | None = None,
    status: str | None = None,
    search: str | None = None,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    rows = et_service.list_personnel(db, {"team": team, "position": position, "level": level, "status": status, "search": search})
    return [et_service.serialize_personnel(row) for row in rows]


@router.post("/personnel")
def create_personnel(
    payload: PersonnelCreate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        row = et_service.create_personnel(db, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_personnel(row)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.post("/personnel/import")
async def import_personnel(
    file: UploadFile = File(...),
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    path = await _save_upload(file)
    try:
        rows = et_excel_service.import_personnel_from_excel(db, path, principal["user_id"])
        _commit_or_rollback(db)
        return {"created": [et_service.serialize_personnel(row) for row in rows]}
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.put("/personnel/bulk-level")
def bulk_update_personnel_level(
    payload: PersonnelBulkLevelUpdate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        rows = et_service.bulk_update_personnel_level(db, payload.personnel_ids, payload.current_level, principal["user_id"])
        _commit_or_rollback(db)
        return [et_service.serialize_personnel(row) for row in rows]
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/personnel/{personnel_id}")
def get_personnel(
    personnel_id: str,
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    try:
        return et_service.serialize_personnel(et_service.get_personnel(db, personnel_id))
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.put("/personnel/{personnel_id}")
def update_personnel(
    personnel_id: str,
    payload: PersonnelUpdate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        row = et_service.update_personnel(db, personnel_id, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_personnel(row)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/assessments/compare")
def compare_assessments(
    left_id: str = Query(...),
    right_id: str = Query(...),
    _: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        return et_service.compare_assessments(db, left_id, right_id)
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.get("/assessments")
def list_assessments(
    personnel_id: str | None = None,
    team: str | None = None,
    period: str | None = None,
    status: str | None = None,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    if principal["role"] == Role.TEAM_ACCOUNT.value:
        own_ids = [row[0] for row in db.execute(select(Personnel.id).where(Personnel.user_id == principal["user_id"])).all()]
        if personnel_id and personnel_id not in own_ids:
            raise HTTPException(status_code=403, detail="Access denied")
        if not own_ids:
            return []
        rows = []
        for own_id in own_ids:
            rows.extend(et_service.list_assessments(db, {"personnel_id": own_id, "period": period, "status": status}))
        return [et_service.serialize_assessment(row, include_items=False) for row in rows]
    rows = et_service.list_assessments(db, {"personnel_id": personnel_id, "team": team, "period": period, "status": status})
    return [et_service.serialize_assessment(row, include_items=False) for row in rows]


@router.post("/assessments")
def create_assessment(
    payload: AssessmentCreate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        assessment = et_service.create_assessment(db, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_assessment(assessment)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/assessments/{assessment_id}")
def get_assessment(
    assessment_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    try:
        assessment = et_service.get_assessment(db, assessment_id)
        if not et_service.can_access_personnel(db, principal, assessment.personnel_id):
            raise HTTPException(status_code=403, detail="Access denied")
        return et_service.serialize_assessment(assessment)
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.put("/assessments/{assessment_id}")
def update_assessment(
    assessment_id: str,
    payload: AssessmentUpdate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        assessment = et_service.update_assessment(db, assessment_id, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_assessment(assessment)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.post("/assessments/{assessment_id}/refresh-required-scores")
def refresh_required_scores(
    assessment_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        assessment = et_service.refresh_required_scores(db, assessment_id, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_assessment(assessment)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.post("/assessments/{assessment_id}/submit")
def submit_assessment(
    assessment_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        assessment = et_service.submit_assessment(db, assessment_id, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_assessment(assessment)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/assessments/{assessment_id}/export")
def export_assessment(
    assessment_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    try:
        assessment = et_service.get_assessment(db, assessment_id)
        if not et_service.can_access_personnel(db, principal, assessment.personnel_id):
            raise HTTPException(status_code=403, detail="Access denied")
        path = et_excel_service.export_assessment_to_excel(assessment)
        return FileResponse(path, filename=Path(path).name)
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.get("/personnel/{personnel_id}/assessment-history")
def assessment_history(
    personnel_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    if not et_service.can_access_personnel(db, principal, personnel_id):
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        return [et_service.serialize_assessment(row, include_items=False) for row in et_service.get_assessment_history(db, personnel_id)]
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.get("/learning-plans")
def list_learning_plans(
    personnel_id: str | None = None,
    team: str | None = None,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    if principal["role"] == Role.TEAM_ACCOUNT.value:
        own_ids = [row[0] for row in db.execute(select(Personnel.id).where(Personnel.user_id == principal["user_id"])).all()]
        if personnel_id and personnel_id not in own_ids:
            raise HTTPException(status_code=403, detail="Access denied")
        rows = []
        for own_id in own_ids:
            rows.extend(et_service.list_learning_plans(db, {"personnel_id": own_id}))
        return [et_service.serialize_learning_plan(row, include_items=False) for row in rows]
    rows = et_service.list_learning_plans(db, {"personnel_id": personnel_id, "team": team})
    return [et_service.serialize_learning_plan(row, include_items=False) for row in rows]


@router.post("/learning-plans")
def create_learning_plan(
    payload: LearningPlanCreate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        plan = et_service.create_learning_plan(db, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_learning_plan(plan)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/learning-plans/{plan_id}")
def get_learning_plan(
    plan_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    try:
        plan = et_service.get_learning_plan(db, plan_id)
        if not et_service.can_access_personnel(db, principal, plan.personnel_id):
            raise HTTPException(status_code=403, detail="Access denied")
        return et_service.serialize_learning_plan(plan)
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.put("/learning-plans/{plan_id}")
def update_learning_plan(
    plan_id: str,
    payload: LearningPlanUpdate,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        plan = et_service.update_learning_plan(db, plan_id, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_learning_plan(plan)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.post("/learning-plans/{plan_id}/auto-generate")
def auto_generate_learning_plan(
    plan_id: str,
    payload: LearningPlanAutoGenerateRequest,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        plan = et_service.auto_generate_learning_plan(db, plan_id, payload, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_learning_plan(plan)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.put("/learning-plans/{plan_id}/items/{item_id}/complete")
def complete_learning_plan_item(
    plan_id: str,
    item_id: str,
    payload: LearningPlanCompleteRequest,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    try:
        plan = et_service.mark_plan_item_complete(db, plan_id, item_id, payload.actual_level, principal["user_id"])
        _commit_or_rollback(db)
        return et_service.serialize_learning_plan(plan)
    except ETValidationError as exc:
        db.rollback()
        raise _handle_error(exc) from exc


@router.get("/learning-plans/{plan_id}/export")
def export_learning_plan(
    plan_id: str,
    principal: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.TEAM_ACCOUNT)),
    db: Session = Depends(get_db),
):
    try:
        plan = et_service.get_learning_plan(db, plan_id)
        if not et_service.can_access_personnel(db, principal, plan.personnel_id):
            raise HTTPException(status_code=403, detail="Access denied")
        path = et_excel_service.export_learning_plan_to_excel(plan)
        return FileResponse(path, filename=Path(path).name)
    except ETValidationError as exc:
        raise _handle_error(exc) from exc


@router.get("/dashboard")
def dashboard_summary(
    team: str | None = None,
    position: str | None = None,
    level: int | None = None,
    result: str | None = None,
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR)),
    db: Session = Depends(get_db),
):
    return et_service.get_dashboard_summary(db, {"team": team, "position": position, "level": level, "result": result})


@router.get("/dashboard/heatmap")
def dashboard_heatmap(
    team: str | None = None,
    position: str | None = None,
    level: int | None = None,
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)),
    db: Session = Depends(get_db),
):
    return et_service.get_heatmap_data(db, {"team": team, "position": position, "level": level})


@router.get("/dashboard/export")
def export_dashboard(
    team: str | None = None,
    position: str | None = None,
    level: int | None = None,
    result: str | None = None,
    _: dict[str, str] = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER, Role.FI_COORDINATOR)),
    db: Session = Depends(get_db),
):
    data = et_service.get_dashboard_summary(db, {"team": team, "position": position, "level": level, "result": result})
    path = et_excel_service.export_dashboard_summary_to_excel(data)
    return FileResponse(path, filename=Path(path).name)
