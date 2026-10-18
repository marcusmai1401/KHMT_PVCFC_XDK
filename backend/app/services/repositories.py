from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.domain import (
    AuditLogModel,
    IdempotencyKeyModel,
    NotificationModel,
    SKImageModel,
    TeamReportModel,
    WarningModel,
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def make_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    return value


def model_to_dict(model: Any) -> dict[str, Any]:
    data = {column.name: getattr(model, column.name) for column in model.__table__.columns}
    return json_safe(data)


def audit(db: Session, actor: str, entity_type: str, entity_id: str, action: str, changes: Any) -> None:
    db.add(
        AuditLogModel(
            id=make_id("audit"),
            actor=actor,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            changes=json_safe(changes),
        )
    )


def notify(
    db: Session,
    event: str,
    payload: dict[str, Any],
    recipient_role: str | None = None,
    recipient_user_id: str | None = None,
) -> NotificationModel:
    notification = NotificationModel(
        id=make_id("notif"),
        recipient_role=recipient_role,
        recipient_user_id=recipient_user_id,
        event=event,
        payload=json_safe(payload),
        read=False,
    )
    db.add(notification)
    return notification


def idempotency_replay(
    db: Session,
    *,
    actor: str,
    scope: str,
    key: str,
    request_hash: str,
) -> dict[str, Any] | None:
    existing = db.execute(
        select(IdempotencyKeyModel).where(
            IdempotencyKeyModel.actor == actor,
            IdempotencyKeyModel.scope == scope,
            IdempotencyKeyModel.key == key,
        )
    ).scalar_one_or_none()
    if existing is None:
        return None
    if existing.request_hash != request_hash:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409,
            detail={
                "code": "IDEMPOTENCY_CONFLICT",
                "error_code": "IDEMPOTENCY_CONFLICT",
                "message": "Idempotency-Key đã được dùng cho payload khác",
                "request_id": make_id("request"),
            },
        )
    return existing.response


def remember_idempotency(
    db: Session,
    *,
    actor: str,
    scope: str,
    key: str,
    request_hash: str,
    response: dict[str, Any],
    status_code: int = 200,
) -> None:
    db.add(
        IdempotencyKeyModel(
            id=make_id("idem"),
            actor=actor,
            scope=scope,
            key=key,
            request_hash=request_hash,
            response=json_safe(response),
            status_code=status_code,
        )
    )


def warning_from_dict(db: Session, team_report_id: str | None, warning: dict[str, Any]) -> WarningModel:
    record = WarningModel(
        id=warning.get("id") or make_id("warn"),
        team_report_id=team_report_id,
        warning_type=warning["warning_type"],
        severity=warning.get("severity", "MEDIUM"),
        source_cell=warning.get("source_cell"),
        extracted_value=json_safe(warning.get("extracted_value")),
        reason=warning.get("reason", ""),
        admin_action=warning.get("admin_action", "PENDING"),
    )
    db.add(record)
    return record


def current_report_for(db: Session, team: str | None, month: int | None, year: int | None) -> TeamReportModel | None:
    if team is None or month is None or year is None:
        return None
    return db.execute(
        select(TeamReportModel).where(
            TeamReportModel.team == team,
            TeamReportModel.report_month == month,
            TeamReportModel.report_year == year,
            TeamReportModel.is_current_version.is_(True),
            TeamReportModel.report_status.in_(["submitted", "locked"]),
        )
    ).scalar_one_or_none()


def sk_image_to_dict(image: SKImageModel) -> dict[str, Any]:
    return public_report_dict(image)


def public_report_dict(model: Any) -> dict[str, Any]:
    """API metadata; filesystem locations remain internal."""
    data = model_to_dict(model)
    data.pop("file_path", None)
    return data
