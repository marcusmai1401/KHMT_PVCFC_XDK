from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import NotificationModel, NotificationReceiptModel
from app.services.repositories import audit, make_id, model_to_dict

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _recipient_predicate(notification: NotificationModel, principal: dict):
    """The list and read endpoints must use the same recipient semantics."""
    return or_(
        notification.recipient_user_id == principal["user_id"],
        notification.recipient_role == principal["role"],
        and_(notification.recipient_user_id.is_(None), notification.recipient_role.is_(None)),
    )


@router.get("")
def list_notifications(
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    user_id = principal["user_id"]
    query = select(NotificationModel).where(_recipient_predicate(NotificationModel, principal))
    records = db.execute(query.order_by(NotificationModel.created_at.desc())).scalars().all()
    if not records:
        return []
    ids = [record.id for record in records]
    read_ids = set(
        db.execute(
            select(NotificationReceiptModel.notification_id).where(
                NotificationReceiptModel.user_id == user_id,
                NotificationReceiptModel.notification_id.in_(ids),
            )
        ).scalars()
    )
    return [
        {
            **model_to_dict(record),
            # Legacy shared `read=true` cannot identify which recipient read
            # it. It is intentionally excluded from the new unread badge.
            "read": record.id in read_ids or bool(record.read),
            "read_status": "read" if record.id in read_ids else ("legacy_unknown" if record.read else "unread"),
        }
        for record in records
    ]


@router.put("/read-all")
def mark_all_read(
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    user_id = principal["user_id"]
    already_read = select(NotificationReceiptModel.notification_id).where(NotificationReceiptModel.user_id == user_id)
    unread_ids = db.execute(
        select(NotificationModel.id).where(
            _recipient_predicate(NotificationModel, principal),
            NotificationModel.id.not_in(already_read),
        )
    ).scalars().all()
    if unread_ids:
        dialect = db.get_bind().dialect.name
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        elif dialect == "sqlite":
            from sqlalchemy.dialects.sqlite import insert
        else:
            raise RuntimeError("Unsupported receipt database")
        db.execute(insert(NotificationReceiptModel).values([
            {"id": make_id("receipt"), "notification_id": notification_id, "user_id": user_id}
            for notification_id in unread_ids
        ]).on_conflict_do_nothing(index_elements=["notification_id", "user_id"]))
        audit(db, user_id, "Notification", user_id, "mark_all_read", {"count": len(unread_ids)})
    db.commit()
    return {"marked": len(unread_ids)}


@router.put("/{notification_id}/read")
def mark_read(
    notification_id: str,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    record = db.execute(
        select(NotificationModel).where(
            NotificationModel.id == notification_id,
            _recipient_predicate(NotificationModel, principal),
        )
    ).scalar_one_or_none()
    if record is None:
        # Do not reveal whether a foreign notification ID exists.
        raise HTTPException(status_code=404, detail="Không tìm thấy thông báo")
    existing = db.execute(
        select(NotificationReceiptModel).where(
            NotificationReceiptModel.notification_id == notification_id,
            NotificationReceiptModel.user_id == principal["user_id"],
        )
    ).scalar_one_or_none()
    if existing is None:
        dialect = db.get_bind().dialect.name
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        elif dialect == "sqlite":
            from sqlalchemy.dialects.sqlite import insert
        else:
            raise RuntimeError("Unsupported receipt database")
        created_id = db.execute(insert(NotificationReceiptModel).values(
            id=make_id("receipt"), notification_id=notification_id, user_id=principal["user_id"],
        ).on_conflict_do_nothing(index_elements=["notification_id", "user_id"]).returning(NotificationReceiptModel.id)).scalar_one_or_none()
        existing = db.execute(select(NotificationReceiptModel).where(
            NotificationReceiptModel.notification_id == notification_id,
            NotificationReceiptModel.user_id == principal["user_id"],
        )).scalar_one()
        if created_id is not None:
            audit(db, principal["user_id"], "Notification", notification_id, "mark_read", {})
    db.commit()
    return {**model_to_dict(record), "read": True, "read_status": "read", "read_at": existing.read_at}
