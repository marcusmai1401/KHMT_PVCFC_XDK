from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import NotificationModel
from app.services.repositories import audit, model_to_dict

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    role = principal["role"]
    user_id = principal["user_id"]
    query = select(NotificationModel).where(
        (NotificationModel.recipient_user_id == user_id)
        | (NotificationModel.recipient_role == role)
        | (NotificationModel.recipient_role.is_(None) & NotificationModel.recipient_user_id.is_(None))
    )
    records = db.execute(query.order_by(NotificationModel.created_at.desc())).scalars().all()
    return [model_to_dict(record) for record in records]


@router.put("/{notification_id}/read")
def mark_read(
    notification_id: str,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    record = db.get(NotificationModel, notification_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if record.recipient_user_id not in {None, principal["user_id"]} and record.recipient_role not in {
        None,
        principal["role"],
    }:
        raise HTTPException(status_code=403, detail="Not allowed")
    record.read = True
    audit(db, principal["user_id"], "Notification", notification_id, "mark_read", {})
    db.commit()
    return model_to_dict(record)
