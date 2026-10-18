from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import Role, require_role
from app.db.session import get_db
from app.models.domain import IdempotencyKeyModel, UserFeedbackModel
from app.services.repositories import audit, make_id, model_to_dict


router = APIRouter(prefix="/feedback", tags=["feedback"])
FeedbackType = Literal["loi", "kho_su_dung", "gop_y"]
SAFE_CONTEXT_KEYS = {"route_template", "module", "view", "device_class"}


class FeedbackCreate(BaseModel):
    feedback_type: FeedbackType
    description: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)
    build_id: str | None = Field(default=None, max_length=100)
    consent: bool = False

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Mô tả không được để trống")
        return value

    @field_validator("context")
    @classmethod
    def validate_context(cls, value: dict[str, Any]) -> dict[str, Any]:
        return {
            key: str(raw)[:160]
            for key, raw in value.items()
            if key in SAFE_CONTEXT_KEYS and raw not in (None, "")
        }


class FeedbackStatusUpdate(BaseModel):
    status: Literal["new", "triaged", "resolved", "closed"]


def _request_hash(payload: FeedbackCreate, user_id: str) -> str:
    canonical = json.dumps(
        {"user_id": user_id, **payload.model_dump()},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@router.post("")
def create_feedback(
    payload: FeedbackCreate,
    principal: dict = Depends(require_role(Role.TEAM_ACCOUNT, Role.STAFF, Role.FI_COORDINATOR, Role.WORKSHOP_LEADER, Role.ADMIN)),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    app_build_id: str | None = Header(default=None, alias="X-App-Build-Id"),
):
    if not payload.consent:
        raise HTTPException(status_code=422, detail={"code": "VALIDATION_ERROR", "message": "Bạn cần xác nhận thông tin sẽ được gửi kèm phản hồi."})
    build_id = (payload.build_id or app_build_id or "")[:100]
    payload = payload.model_copy(update={"build_id": build_id or None})
    request_hash = _request_hash(payload, principal["user_id"])
    scope = "feedback:create"
    if idempotency_key:
        existing = db.execute(
            select(IdempotencyKeyModel).where(
                IdempotencyKeyModel.actor == principal["user_id"],
                IdempotencyKeyModel.scope == scope,
                IdempotencyKeyModel.key == idempotency_key,
            )
        ).scalar_one_or_none()
        if existing:
            if existing.request_hash != request_hash:
                raise HTTPException(status_code=409, detail={"code": "IDEMPOTENCY_CONFLICT", "message": "Mã gửi lại đã dùng cho nội dung khác."})
            return existing.response

    feedback = UserFeedbackModel(
        id=make_id("feedback"),
        user_id=principal["user_id"],
        feedback_type=payload.feedback_type,
        description=payload.description,
        context=payload.context,
        build_id=payload.build_id,
        consent=True,
        status="new",
    )
    db.add(feedback)
    db.flush()
    response = {"ticket_id": feedback.id, "received": True, "status": feedback.status}
    if idempotency_key:
        db.add(
            IdempotencyKeyModel(
                id=make_id("idem"),
                actor=principal["user_id"],
                scope=scope,
                key=idempotency_key,
                request_hash=request_hash,
                response=response,
                status_code=201,
            )
        )
    audit(db, principal["user_id"], "UserFeedback", feedback.id, "create", {"feedback_type": payload.feedback_type})
    db.commit()
    return response


@router.get("")
def list_feedback(
    status: str | None = None,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    query = select(UserFeedbackModel).order_by(UserFeedbackModel.created_at.desc())
    if status:
        query = query.where(UserFeedbackModel.status == status)
    return [model_to_dict(row) for row in db.execute(query).scalars().all()]


@router.patch("/{feedback_id}")
def update_feedback_status(
    feedback_id: str,
    payload: FeedbackStatusUpdate,
    principal: dict = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db),
):
    feedback = db.get(UserFeedbackModel, feedback_id)
    if feedback is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy phản hồi")
    feedback.status = payload.status
    audit(db, principal["user_id"], "UserFeedback", feedback.id, "status", {"status": payload.status})
    db.commit()
    return model_to_dict(feedback)
