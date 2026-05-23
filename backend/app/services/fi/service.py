from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import Role
from app.models.domain import SKCTKTModel, SKCodeSequenceModel, SKImageModel
from app.services.fi.workflow import FIAction, SKStatus, is_public_status, next_status
from app.services.repositories import audit, make_id, model_to_dict, notify

NON_DRAFT_STATUSES = {status.value for status in SKStatus if status != SKStatus.DRAFT}
OWNER_DELETABLE_STATUSES = {SKStatus.DRAFT.value}
REVIEWABLE_STATUSES = {
    SKStatus.SUBMITTED.value,
    SKStatus.REVIEWED.value,
    SKStatus.DEFERRED.value,
}
HISTORICAL_REVIEW_ACTIONS = {FIAction.APPROVE.value, FIAction.REJECT.value}
SHARED_CONTENT_EDIT_FIELDS = {"content_description", "completion_plan"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def generate_sk_code(db: Session, team: str, year: int) -> str:
    prefix = f"FI-{year}-{team}"
    sequence = db.get(SKCodeSequenceModel, prefix)
    if sequence is None:
        sequence = SKCodeSequenceModel(prefix=prefix, next_value=1)
        db.add(sequence)
        db.flush()
    value = sequence.next_value
    sequence.next_value += 1
    return f"{prefix}-{value:04d}"


def _int_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def create_sk_ctkt(db: Session, payload: dict[str, Any], actor: str) -> SKCTKTModel:
    now = _utc_now()
    team = payload["team"]
    year = _int_or_default(payload.get("year") or payload.get("registration_year"), now.year)
    registration_month = _int_or_default(payload.get("registration_month"), now.month)
    if registration_month < 1 or registration_month > 12:
        registration_month = now.month
    registration_year = _int_or_default(payload.get("registration_year"), year)
    record = SKCTKTModel(
        id=make_id("sk"),
        sk_code=generate_sk_code(db, team, year),
        title=payload["title"],
        author_name=payload["author_name"],
        author_user_id=payload.get("author_user_id") or actor,
        team=team,
        content_description=payload["content_description"],
        completion_plan=payload["completion_plan"],
        status=SKStatus.DRAFT.value,
        status_history=[
            {
                "from_status": None,
                "to_status": SKStatus.DRAFT.value,
                "changed_by": actor,
                "changed_at": now.isoformat(),
                "reason": "web_registration",
                "comments": {
                    "registration_month": registration_month,
                    "registration_year": registration_year,
                    "source": "web",
                },
            }
        ],
        consider_for_khmt=False,
        is_public=False,
        is_counted_for_okr=False,
        is_historical_import=False,
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    audit(db, actor, "SK_CTKT", record.id, "create", model_to_dict(record))
    db.commit()
    db.refresh(record)
    return record


def can_view_sk(record: SKCTKTModel, principal: dict[str, str]) -> bool:
    role = principal["role"]
    user_id = principal["user_id"]
    if record.status in NON_DRAFT_STATUSES:
        return role in {
            Role.TEAM_ACCOUNT.value,
            Role.ADMIN.value,
            Role.FI_COORDINATOR.value,
            Role.WORKSHOP_LEADER.value,
        }
    return record.author_user_id == user_id


def require_visible(record: SKCTKTModel, principal: dict[str, str]) -> None:
    if not can_view_sk(record, principal):
        raise HTTPException(status_code=403, detail="Not allowed")


def update_sk_ctkt(
    db: Session,
    record_id: str,
    payload: dict[str, Any],
    actor: str,
    role: str,
) -> SKCTKTModel:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    requested_fields = set(payload)
    shared_content_edit = bool(requested_fields) and requested_fields <= SHARED_CONTENT_EDIT_FIELDS
    if role != Role.ADMIN.value:
        if shared_content_edit:
            require_visible(record, {"user_id": actor, "role": role})
        else:
            if record.author_user_id != actor:
                raise PermissionError("Only owner or Admin can edit")
            if record.status not in {SKStatus.DRAFT.value, SKStatus.NEED_MORE_INFO.value}:
                raise PermissionError("Only Draft or NeedMoreInfo entries are editable by owner")
    before = model_to_dict(record)
    if role != Role.ADMIN.value and "team" in payload and payload["team"] != record.team:
        raise PermissionError("Tài khoản đội/tổ không được đổi đội/tổ của SK")
    for field in ["title", "content_description", "completion_plan", "author_name"]:
        if field in payload:
            setattr(record, field, payload[field])
    if role == Role.ADMIN.value and "team" in payload:
        record.team = payload["team"]
    audit(db, actor, "SK_CTKT", record_id, "update", {"before": before, "after": model_to_dict(record)})
    db.commit()
    db.refresh(record)
    return record


def _validate_actor_for_transition(record: SKCTKTModel, action: str, actor: str, role: str) -> None:
    if role == Role.TEAM_ACCOUNT.value:
        if record.author_user_id != actor:
            raise PermissionError("Chỉ tài khoản tạo SK mới được thực hiện thao tác này")
        if action == FIAction.SUBMIT.value and record.status not in {
            SKStatus.DRAFT.value,
            SKStatus.NEED_MORE_INFO.value,
        }:
            raise PermissionError("Chỉ gửi duyệt được SK ở trạng thái Nháp hoặc Cần bổ sung")
        if action == FIAction.CANCEL.value and record.status not in {
            SKStatus.DRAFT.value,
            SKStatus.NEED_MORE_INFO.value,
        }:
            raise PermissionError("Chỉ hủy được SK ở trạng thái Nháp hoặc Cần bổ sung")
    if role in {Role.FI_COORDINATOR.value, Role.WORKSHOP_LEADER.value}:
        if action in {FIAction.APPROVE.value, FIAction.REJECT.value} and record.status not in REVIEWABLE_STATUSES:
            raise PermissionError("Chỉ duyệt/từ chối được SK ở trạng thái Chờ xét duyệt, Đã xem xét hoặc Xem xét sau")


def transition_sk_ctkt(
    db: Session,
    record_id: str,
    action: str,
    actor: str,
    role: str,
    note: str | None = None,
    comments: str | None = None,
) -> SKCTKTModel:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    if record.is_historical_import:
        if action not in HISTORICAL_REVIEW_ACTIONS or record.status not in {
            SKStatus.SUBMITTED.value,
            SKStatus.DEFERRED.value,
        }:
            raise PermissionError("FI legacy chỉ cho xét duyệt các mục Chờ xét duyệt hoặc Xem xét sau")
    _validate_actor_for_transition(record, action, actor, role)
    result = next_status(record.status, action, role, note)
    before = record.status
    now = _utc_now()
    record.status = result.to_status.value
    record.is_public = is_public_status(record.status)
    if comments and action == FIAction.REVIEW.value:
        record.fi_coordinator_comments = comments
    if note:
        record.decision_note = note
    if record.is_historical_import:
        record.is_counted_for_okr = (
            record.status in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
            and record.khmt_month is not None
            and record.khmt_year is not None
        )
    if record.status == SKStatus.SUBMITTED.value:
        record.submitted_at = now
    elif record.status == SKStatus.REVIEWED.value:
        record.reviewed_at = now
    elif record.status == SKStatus.APPROVED.value:
        record.approved_at = now
    elif record.status == SKStatus.COMPLETED.value:
        record.completed_at = now
    history = {
        "from_status": before,
        "to_status": record.status,
        "changed_by": actor,
        "changed_at": now.isoformat(),
        "reason": note,
        "comments": comments,
    }
    record.status_history = [*record.status_history, history]
    audit(db, actor, "SK_CTKT", record_id, f"transition:{action}", history)
    _notify_transition(db, record, record_id)
    db.commit()
    db.refresh(record)
    return record


def _notify_transition(db: Session, record: SKCTKTModel, record_id: str) -> None:
    payload = {"id": record_id, "status": record.status, "sk_code": record.sk_code}
    if record.status == SKStatus.SUBMITTED.value:
        notify(db, "SK_SUBMITTED", payload, recipient_role=Role.FI_COORDINATOR.value)
    elif record.status == SKStatus.NEED_MORE_INFO.value:
        notify(db, "SK_NEED_MORE_INFO", payload, recipient_user_id=record.author_user_id)
    elif record.status == SKStatus.REVIEWED.value:
        notify(db, "SK_REVIEWED", payload, recipient_role=Role.FI_COORDINATOR.value)
    elif record.status == SKStatus.APPROVED.value:
        notify(db, "SK_APPROVED", payload, recipient_user_id=record.author_user_id)
        notify(db, "SK_APPROVED", payload, recipient_role=Role.WORKSHOP_LEADER.value)
    elif record.status in {SKStatus.REJECTED.value, SKStatus.DEFERRED.value, SKStatus.CANCELLED.value, SKStatus.COMPLETED.value}:
        notify(db, f"SK_{record.status.upper()}", payload, recipient_user_id=record.author_user_id)
    else:
        notify(db, "SK_STATUS_CHANGED", payload, recipient_user_id=record.author_user_id)


def assign_khmt(db: Session, record_id: str, month: int, year: int, actor: str) -> SKCTKTModel:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    if record.is_historical_import:
        raise ValueError("FI legacy chỉ dùng để tra cứu lịch sử, không gán KHMT từ workflow")
    if record.status not in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}:
        raise ValueError("Only Approved or Completed SK-CTKT can be assigned to KHMT")
    record.khmt_month = month
    record.khmt_year = year
    record.consider_for_khmt = True
    record.is_counted_for_okr = True
    audit(db, actor, "SK_CTKT", record_id, "assign_khmt", {"month": month, "year": year})
    db.commit()
    db.refresh(record)
    return record


def count_for_okr(db: Session, month: int, year: int) -> dict[str, int]:
    counts = {"TBHTĐK": 0, "TBCH": 0, "TBĐL": 0, "TCĐK": 0}
    records = db.execute(
        select(SKCTKTModel).where(
            SKCTKTModel.khmt_month == month,
            SKCTKTModel.khmt_year == year,
            SKCTKTModel.status.in_([SKStatus.APPROVED.value, SKStatus.COMPLETED.value]),
            SKCTKTModel.is_counted_for_okr.is_(True),
        )
    ).scalars()
    for record in records:
        if record.team in counts:
            counts[record.team] += 1
    return counts


def delete_sk_ctkt(db: Session, record_id: str, actor: str, role: str) -> None:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    can_delete = role == Role.ADMIN.value
    if role == Role.TEAM_ACCOUNT.value:
        can_delete = record.author_user_id == actor and record.status in OWNER_DELETABLE_STATUSES
    if not can_delete:
        raise PermissionError("Chỉ người tạo được xóa bản nháp; Admin được xóa SK")
    images = list(db.execute(select(SKImageModel).where(SKImageModel.sk_ctkt_id == record_id)).scalars())
    audit(db, actor, "SK_CTKT", record_id, "delete", {"record": model_to_dict(record), "image_count": len(images)})
    for image in images:
        try:
            Path(image.file_path).unlink(missing_ok=True)
        except OSError:
            pass
        db.delete(image)
    db.delete(record)
    db.commit()
