from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import Role, hash_password, require_role
from app.db.session import get_db
from app.models.domain import (
    AuditLogModel,
    KRMappingModel,
    SystemConfigModel,
    TeamHeadcountModel,
    TemplateModel,
    User,
    VHDNExemptionModel,
)
from app.schemas.common import HeadcountUpdate, SystemConfigUpdate, TemplateUpdate, UserCreate, UserRoleUpdate
from app.services.cache import cache_delete_prefix, cache_get, cache_set
from app.services.repositories import audit, make_id, model_to_dict

router = APIRouter(prefix="/admin", tags=["admin"])


def _validate_role(value: str) -> str:
    try:
        return Role(value).value
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Vai trò không hợp lệ") from exc


def _kr_sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
    code = str(row.get("workshop_kr_code") or "")
    objective, _, kr = code.partition(".KR")
    if not objective.startswith("O") or not kr:
        return (10_000, 10_000, code)
    try:
        return (int(objective[1:]), int(kr), code)
    except ValueError:
        return (10_000, 10_000, code)


@router.get("/users")
def list_users(
    _: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    return [model_to_dict(user) | {"password_hash": None} for user in db.execute(select(User)).scalars()]


@router.post("/users")
def create_user(
    payload: UserCreate,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    if db.get(User, payload.id) is not None:
        raise HTTPException(status_code=409, detail="Tài khoản đã tồn tại")
    user = User(
        id=payload.id,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=_validate_role(payload.role),
        is_active=payload.is_active,
    )
    db.add(user)
    audit(db, principal["user_id"], "Account", user.id, "create", {"role": user.role})
    db.commit()
    return model_to_dict(user) | {"password_hash": None}


@router.put("/users/{user_id}/role")
def update_user_role(
    user_id: str,
    payload: UserRoleUpdate,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    before = model_to_dict(user)
    user.role = _validate_role(payload.role)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    audit(db, principal["user_id"], "Account", user.id, "update_role", {"before": before, "after": model_to_dict(user)})
    db.commit()
    return model_to_dict(user) | {"password_hash": None}


@router.get("/kr-mapping")
def kr_mapping(principal: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    cache_key = f"admin:{'sandbox' if principal.get('sandbox') else 'prod'}:kr_mapping"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    records = db.execute(select(KRMappingModel).order_by(KRMappingModel.dashboard_column)).scalars().all()
    data = sorted((model_to_dict(record) for record in records), key=_kr_sort_key)
    cache_set(cache_key, data, 24 * 60 * 60)
    return data


@router.put("/kr-mapping")
def update_kr_mapping(
    payload: list[dict[str, Any]],
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    updated = []
    for item in payload:
        code = item.get("workshop_kr_code")
        if not code:
            raise HTTPException(status_code=400, detail="workshop_kr_code is required")
        record = db.get(KRMappingModel, code)
        if record is None:
            record = KRMappingModel(
                workshop_kr_code=code,
                kr_name=item.get("kr_name", code),
                dashboard_column=item.get("dashboard_column", ""),
                measurement_type=item.get("measurement_type", "Unknown"),
                target_value=item.get("target_value", ""),
                source_row=item.get("source_row"),
            )
            db.add(record)
        else:
            for field in ["kr_name", "dashboard_column", "measurement_type", "target_value", "source_row"]:
                if field in item:
                    setattr(record, field, item[field])
        updated.append(record)
    audit(db, principal["user_id"], "KRMapping", "bulk", "update", {"count": len(updated)})
    db.commit()
    cache_delete_prefix("admin:")
    cache_delete_prefix("okr:dashboard")
    return [model_to_dict(record) for record in updated]


@router.get("/headcount")
def headcount(principal: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    cache_key = f"admin:{'sandbox' if principal.get('sandbox') else 'prod'}:headcount"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    records = db.execute(select(TeamHeadcountModel)).scalars().all()
    teams = {
        record.team: {
            "total_headcount": record.total_headcount,
            "vhdn_eligible_headcount": record.vhdn_eligible_headcount,
            "effective_month": record.effective_month,
            "effective_year": record.effective_year,
            "notes": record.notes,
        }
        for record in records
        if record.team != "Workshop_Staff"
    }
    workshop = next((record.total_headcount for record in records if record.team == "Workshop_Staff"), 0)
    data = {"teams": teams, "workshop_staff": workshop}
    cache_set(cache_key, data, 60 * 60)
    return data


@router.put("/headcount")
def update_headcount(
    payload: HeadcountUpdate,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    record = db.execute(
        select(TeamHeadcountModel).where(
            TeamHeadcountModel.team == payload.team,
            TeamHeadcountModel.effective_month == payload.effective_month,
            TeamHeadcountModel.effective_year == payload.effective_year,
        )
    ).scalar_one_or_none()
    if record is None:
        record = TeamHeadcountModel(
            id=make_id("headcount"),
            team=payload.team,
            effective_month=payload.effective_month,
            effective_year=payload.effective_year,
            total_headcount=payload.total_headcount,
            vhdn_eligible_headcount=payload.vhdn_eligible_headcount,
            notes=payload.notes,
        )
        db.add(record)
    else:
        record.total_headcount = payload.total_headcount
        record.vhdn_eligible_headcount = payload.vhdn_eligible_headcount
        record.notes = payload.notes
    audit(db, principal["user_id"], "Headcount", record.id, "upsert", model_to_dict(record))
    db.commit()
    cache_delete_prefix("admin:")
    cache_delete_prefix("okr:dashboard")
    return model_to_dict(record)


@router.get("/exemptions")
def exemptions(_: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    records = db.execute(select(VHDNExemptionModel)).scalars().all()
    return [model_to_dict(record) for record in records]


@router.get("/audit-log")
def audit_log(
    actor: str | None = None,
    entity_type: str | None = None,
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    _: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    query = select(AuditLogModel)
    if actor:
        query = query.where(AuditLogModel.actor == actor)
    if entity_type:
        query = query.where(AuditLogModel.entity_type == entity_type)
    if date_from:
        query = query.where(AuditLogModel.created_at >= date_from)
    if date_to:
        query = query.where(AuditLogModel.created_at <= date_to)
    records = db.execute(query.order_by(AuditLogModel.created_at.desc())).scalars().all()
    return [model_to_dict(record) for record in records]


@router.get("/config")
def config(_: dict = Depends(require_role(Role.ADMIN)), db: Session = Depends(get_db)):
    return {record.key: record.value for record in db.execute(select(SystemConfigModel)).scalars()}


@router.put("/config")
def update_config(
    payload: SystemConfigUpdate,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        record = db.get(SystemConfigModel, key)
        if record is None:
            record = SystemConfigModel(key=key, value=value, updated_by=principal["user_id"])
            db.add(record)
        else:
            record.value = value
            record.updated_by = principal["user_id"]
    audit(db, principal["user_id"], "SystemConfig", "bulk", "update", updates)
    db.commit()
    return config(principal, db)


@router.get("/templates")
def templates(_: dict = Depends(require_role(Role.ADMIN, Role.WORKSHOP_LEADER)), db: Session = Depends(get_db)):
    return [model_to_dict(record) for record in db.execute(select(TemplateModel)).scalars()]


@router.put("/templates/{template_id}")
def update_template(
    template_id: str,
    payload: TemplateUpdate,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    record = db.get(TemplateModel, template_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if payload.name is not None:
        record.name = payload.name
    record.definition = payload.definition
    record.updated_by = principal["user_id"]
    audit(db, principal["user_id"], "Template", template_id, "update", model_to_dict(record))
    db.commit()
    return model_to_dict(record)
