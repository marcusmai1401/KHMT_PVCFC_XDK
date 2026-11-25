"""FI implementation/execution tracking rules, permissions, and update service."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import Role
from app.models.domain import SKCTKTModel, SKImageModel, User
from app.services.fi.auto_completion import (
    AUTO_DONE_REASON,
    AUTO_PLANNED_REASON,
    completion_plan_due_date,
    factory_today,
    format_plan,
)
from app.services.fi.completion import (
    completion_date_to_datetime,
    completion_plan_completed_at,
    completion_plan_indicates_done,
)
from app.services.fi.team_guard import lock_fi_teams
from app.services.fi.workflow import SKStatus
from app.services.repositories import audit, model_to_dict, notify

EXECUTION_STATUS_IN_PROGRESS = "in_progress"
EXECUTION_STATUS_PAUSED = "paused"
EXECUTION_STATUS_COMPLETED = "completed"
EXECUTION_STATUS_AUTO_COMPLETED = "auto_completed"

EXECUTION_EDITABLE_STATUSES = {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
OWNER_PRE_APPROVAL_PLAN_STATUSES = {
    SKStatus.SUBMITTED.value,
    SKStatus.NEED_MORE_INFO.value,
    SKStatus.REVIEWED.value,
    SKStatus.DEFERRED.value,
    SKStatus.REJECTED.value,
}
PLAN_HISTORY_REASONS = {
    "completion_plan_update",
    "execution_update",
    AUTO_DONE_REASON,
    AUTO_PLANNED_REASON,
    "completion_auto_done_reverted",
}
IMAGE_STAGE_REGISTRATION = "registration"
IMAGE_STAGE_COMPLETION = "completion"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _local_date(value: datetime | None) -> date | None:
    if value is None:
        return None
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return (aware.astimezone(timezone.utc) + timedelta(hours=7)).date()


def last_plan_history_reason(record: SKCTKTModel) -> str | None:
    history = record.status_history if isinstance(record.status_history, list) else []
    for entry in reversed(history):
        if isinstance(entry, dict) and entry.get("reason") in PLAN_HISTORY_REASONS:
            return str(entry.get("reason"))
    return None


def format_execution_plan(execution_status: str, completion_date: date | None) -> str:
    if execution_status == EXECUTION_STATUS_COMPLETED:
        target = completion_date or factory_today()
        return format_plan(True, target)
    if execution_status == EXECUTION_STATUS_PAUSED:
        if completion_date is not None:
            return f"Tạm dừng · Dự kiến {completion_date.strftime('%d/%m/%Y')}"
        return "Tạm dừng / Chờ điều kiện triển khai"
    target = completion_date or (factory_today() + timedelta(days=30))
    return format_plan(False, target)


def is_record_paused(record: SKCTKTModel) -> bool:
    return record.execution_status == EXECUTION_STATUS_PAUSED


def is_record_auto_done(record: SKCTKTModel, *, today: date | None = None) -> bool:
    if record.status not in EXECUTION_EDITABLE_STATUSES:
        return False
    if record.execution_status == EXECUTION_STATUS_PAUSED:
        return False
    if record.execution_status == EXECUTION_STATUS_COMPLETED:
        return False
    if record.execution_status == EXECUTION_STATUS_AUTO_COMPLETED:
        return True
    ref_today = today or factory_today()
    if record.completed_at is not None:
        completed_on = _local_date(record.completed_at)
        if completed_on is not None and completed_on <= ref_today:
            return last_plan_history_reason(record) == AUTO_DONE_REASON
        return False
    if completion_plan_indicates_done(record.completion_plan):
        return last_plan_history_reason(record) == AUTO_DONE_REASON
    due = completion_plan_due_date(record.completion_plan)
    return due is not None and due <= ref_today


def is_record_completed(record: SKCTKTModel, *, today: date | None = None) -> bool:
    if record.execution_status == EXECUTION_STATUS_PAUSED:
        return False
    ref_today = today or factory_today()
    if record.execution_status == EXECUTION_STATUS_IN_PROGRESS:
        if record.status == SKStatus.APPROVED.value:
            due = completion_plan_due_date(record.completion_plan)
            if due is not None and due <= ref_today:
                return True
        return False
    if record.status == SKStatus.COMPLETED.value:
        return True
    if record.completed_at is not None:
        completed_on = _local_date(record.completed_at)
        if completed_on is None or completed_on <= ref_today:
            return True
        return False
    if record.execution_status in {EXECUTION_STATUS_COMPLETED, EXECUTION_STATUS_AUTO_COMPLETED}:
        return True
    if completion_plan_indicates_done(record.completion_plan):
        inferred = completion_plan_completed_at(record.completion_plan)
        if inferred is None:
            return True
        inferred_day = _local_date(inferred)
        return inferred_day is None or inferred_day <= ref_today
    if record.status == SKStatus.APPROVED.value:
        due = completion_plan_due_date(record.completion_plan)
        if due is not None and due <= ref_today:
            return True
    return False


def can_update_execution(
    record: SKCTKTModel,
    principal: dict[str, Any],
    db: Session,
) -> tuple[bool, str | None]:
    """Single source of truth for execution tracking permissions."""
    from app.services.fi.service import is_author_or_submitter

    role = str(principal.get("role") or "")
    actor = str(principal.get("user_id") or "")
    principal_team = str(principal.get("team") or actor)

    if record.status == SKStatus.CANCELLED.value:
        return False, "SK đã hủy, không thể cập nhật tình hình thực hiện."

    if record.status in EXECUTION_EDITABLE_STATUSES:
        if role == Role.ADMIN.value:
            return True, None
        if role == Role.FI_COORDINATOR.value:
            return True, None
        if role == Role.TEAM_ACCOUNT.value and principal_team == record.team:
            return True, None
        if is_author_or_submitter(record, actor, db):
            return True, None
        return (
            False,
            f"Chỉ tác giả, người gửi hộ, Đội/Tổ trưởng {record.team} hoặc Đầu mối FI mới được cập nhật tình hình thực hiện.",
        )

    if record.status in OWNER_PRE_APPROVAL_PLAN_STATUSES and is_author_or_submitter(record, actor, db):
        return True, None

    return False, "Chỉ cập nhật tình hình thực hiện sau khi SK được Đồng ý."


def can_upload_completion_images(
    record: SKCTKTModel,
    principal: dict[str, Any],
    db: Session,
) -> tuple[bool, str | None]:
    if record.status not in EXECUTION_EDITABLE_STATUSES:
        return False, "Chỉ tải ảnh bằng chứng hoàn thành cho SK đã được Đồng ý."
    return can_update_execution(record, principal, db)


def can_delete_image_for_record(
    record: SKCTKTModel,
    image: SKImageModel,
    principal: dict[str, Any],
    db: Session,
) -> tuple[bool, str | None]:
    from app.services.fi.service import AUTHOR_CONTENT_EDITABLE_STATUSES, is_author_or_submitter

    role = str(principal.get("role") or "")
    actor = str(principal.get("user_id") or "")
    principal_team = str(principal.get("team") or actor)
    image_stage = getattr(image, "stage", IMAGE_STAGE_REGISTRATION) or IMAGE_STAGE_REGISTRATION

    if role == Role.ADMIN.value:
        return True, None

    if record.status in EXECUTION_EDITABLE_STATUSES:
        if image_stage != IMAGE_STAGE_COMPLETION:
            return False, "Không thể xóa ảnh đăng ký gốc của SK đã được Đồng ý."
        if image.uploaded_by == actor:
            return True, None
        if role == Role.FI_COORDINATOR.value:
            return True, None
        if role == Role.TEAM_ACCOUNT.value and principal_team == record.team:
            return True, None
        return False, "Chỉ người tải ảnh, Đội/Tổ trưởng cùng đội, Đầu mối FI hoặc Quản trị mới được xóa ảnh hoàn thành."

    if role in {Role.TEAM_ACCOUNT.value, Role.STAFF.value, Role.FI_COORDINATOR.value}:
        if is_author_or_submitter(record, actor, db) and record.status in AUTHOR_CONTENT_EDITABLE_STATUSES:
            return True, None
    return False, "Chỉ người đăng ký mới được xóa ảnh của hồ sơ đang chỉnh sửa."


def _actor_display_name(db: Session | None, user_id: str | None) -> str | None:
    if not user_id:
        return None
    if user_id in {"system", "historical-import", "deploy-import"}:
        return "Hệ thống"
    if db is None:
        return user_id
    directory = db.info.get("fi_user_directory")
    if directory is not None:
        for user in directory:
            if user.id == user_id:
                return user.full_name or user.display_name or user.id
    user = db.get(User, user_id)
    if user is None:
        return user_id
    return user.full_name or user.display_name or user.id


def resolve_execution_state(
    record: SKCTKTModel,
    *,
    today: date | None = None,
    principal: dict[str, Any] | None = None,
    db: Session | None = None,
) -> dict[str, Any]:
    ref_today = today or factory_today()
    applicable = record.status in EXECUTION_EDITABLE_STATUSES
    due = completion_plan_due_date(record.completion_plan)
    completed_on = _local_date(record.completed_at)
    if completed_on is None and completion_plan_indicates_done(record.completion_plan):
        completed_on = _local_date(completion_plan_completed_at(record.completion_plan))

    if not applicable:
        status_value = "not_applicable"
        is_auto = False
    elif record.execution_status == EXECUTION_STATUS_PAUSED:
        status_value = EXECUTION_STATUS_PAUSED
        is_auto = False
    elif is_record_completed(record, today=ref_today):
        status_value = EXECUTION_STATUS_COMPLETED
        is_auto = is_record_auto_done(record, today=ref_today)
        if completed_on is None and due is not None and due <= ref_today:
            completed_on = due
    else:
        status_value = EXECUTION_STATUS_IN_PROGRESS
        is_auto = False

    updated_at_iso: str | None = None
    if record.execution_updated_at is not None:
        aware_updated = (
            record.execution_updated_at
            if record.execution_updated_at.tzinfo is not None
            else record.execution_updated_at.replace(tzinfo=timezone.utc)
        )
        updated_at_iso = aware_updated.isoformat()

    payload: dict[str, Any] = {
        "status": status_value,
        "raw_status": record.execution_status,
        "is_auto_done": is_auto,
        "applicable": applicable,
        "due_date": due.isoformat() if due else None,
        "completed_date": completed_on.isoformat() if (status_value == EXECUTION_STATUS_COMPLETED and completed_on) else None,
        "note": record.execution_note,
        "updated_at": updated_at_iso,
        "updated_by": record.execution_updated_by,
        "updated_by_name": _actor_display_name(db, record.execution_updated_by),
    }

    if principal is not None and db is not None:
        can_update, blocked_reason = can_update_execution(record, principal, db)
        can_upload_img, _ = can_upload_completion_images(record, principal, db)
        payload["can_update"] = can_update
        payload["update_blocked_reason"] = blocked_reason
        payload["can_upload_completion_image"] = can_upload_img

    return payload


def lock_record_for_execution_update(db: Session, record_id: str) -> SKCTKTModel:
    """Acquire team -> SK row lock without enforcing KHMT period lock.

    Execution updates and completion-stage images never mutate team, approval status,
    approved_at, or KHMT allocation fields, so locked KHMT periods remain invariant.
    """
    preliminary = db.get(SKCTKTModel, record_id)
    if preliminary is None:
        raise KeyError("SK-CTKT not found")
    team = str(preliminary.team)
    lock_fi_teams(db, {team})
    db.refresh(preliminary)
    if preliminary.team != team:
        raise HTTPException(
            status_code=409,
            detail={"code": "VERSION_CONFLICT", "message": "Đội của FI vừa thay đổi. Vui lòng tải lại."},
        )
    record = db.execute(
        select(SKCTKTModel)
        .where(SKCTKTModel.id == record_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if record is None:
        raise KeyError("SK-CTKT not found")
    if record.team != team:
        raise HTTPException(
            status_code=409,
            detail={"code": "VERSION_CONFLICT", "message": "Đội của FI vừa thay đổi. Vui lòng tải lại."},
        )
    return record


def lock_record_for_execution_or_content(db: Session, record_id: str) -> SKCTKTModel:
    """Lock an SK for an execution/plan mutation.

    Approved/Completed SKs skip the KHMT period lock (their allocation fields are
    never touched); any other status keeps the full team -> period -> SK lock so a
    locked period still rejects pre-approval plan edits.
    """
    from app.services.fi.service import _lock_record_context

    preliminary = db.get(SKCTKTModel, record_id)
    if preliminary is None:
        raise KeyError("SK-CTKT not found")
    if preliminary.status in EXECUTION_EDITABLE_STATUSES:
        record = lock_record_for_execution_update(db, record_id)
        if record.status in EXECUTION_EDITABLE_STATUSES:
            return record
    record, _guard = _lock_record_context(db, record_id)
    return record


def update_sk_execution(
    db: Session,
    record_id: str,
    *,
    execution_status: str,
    completion_date: date | None,
    execution_note: str | None,
    expected_revision: int | None,
    principal: dict[str, Any],
) -> SKCTKTModel:
    from app.services.fi.service import _assert_revision, _owner_recipient_ids

    record = lock_record_for_execution_or_content(db, record_id)
    _assert_revision(record, expected_revision)

    allowed, reason = can_update_execution(record, principal, db)
    if not allowed:
        raise PermissionError(reason or "Tài khoản không có quyền cập nhật tình hình thực hiện")

    today = factory_today()
    is_approved = record.status in EXECUTION_EDITABLE_STATUSES
    cleaned_note = (execution_note or "").strip() or None

    if execution_status == EXECUTION_STATUS_PAUSED and not is_approved:
        raise HTTPException(status_code=400, detail="Chỉ áp dụng trạng thái Tạm dừng đối với SK đã được Đồng ý.")

    if execution_status == EXECUTION_STATUS_COMPLETED:
        target_date = completion_date or today
        if target_date > today:
            raise HTTPException(status_code=400, detail="Ngày hoàn thành không được sau ngày hôm nay.")
        next_plan = format_plan(True, target_date)
        next_completed_at = completion_date_to_datetime(target_date)
    elif execution_status == EXECUTION_STATUS_PAUSED:
        if completion_date is not None and completion_date < today:
            raise HTTPException(status_code=400, detail="Ngày dự kiến mới không được trước ngày hôm nay.")
        next_plan = format_execution_plan(EXECUTION_STATUS_PAUSED, completion_date)
        next_completed_at = None
    elif execution_status == EXECUTION_STATUS_IN_PROGRESS:
        if completion_date is None:
            raise HTTPException(status_code=400, detail="Vui lòng chọn ngày dự kiến hoàn thành.")
        if is_approved and completion_date <= today:
            raise HTTPException(
                status_code=400,
                detail="Ngày dự kiến phải sau hôm nay. Nếu đã xong chọn “Đã hoàn thành”; nếu đang chờ dừng máy/vật tư chọn “Tạm dừng”.",
            )
        if not is_approved and completion_date <= today:
            raise HTTPException(status_code=400, detail="Ngày dự kiến hoàn thành phải sau ngày hôm nay.")
        next_plan = format_plan(False, completion_date)
        next_completed_at = None
    else:
        raise HTTPException(status_code=400, detail="Trạng thái thực hiện không hợp lệ.")

    actor = str(principal["user_id"])
    now = _utc_now()
    before = model_to_dict(record)
    previous_exec_status = record.execution_status
    previous_plan = record.completion_plan
    previous_completed_at = record.completed_at

    record.execution_status = execution_status if is_approved else None
    record.execution_note = cleaned_note
    record.execution_updated_at = now
    record.execution_updated_by = actor
    record.completion_plan = next_plan
    record.completed_at = next_completed_at
    record.updated_at = now
    record.revision += 1

    history = record.status_history if isinstance(record.status_history, list) else []
    record.status_history = [
        *history,
        {
            "from_status": record.status,
            "to_status": record.status,
            "changed_by": actor,
            "changed_at": now.isoformat(),
            "reason": "execution_update",
            "comments": {
                "previous_execution_status": previous_exec_status,
                "execution_status": execution_status,
                "previous_completion_plan": previous_plan,
                "completion_plan": next_plan,
                "previous_completed_at": previous_completed_at.isoformat() if previous_completed_at else None,
                "completed_at": next_completed_at.isoformat() if next_completed_at else None,
                "execution_note": cleaned_note,
            },
        },
    ]

    audit(
        db,
        actor,
        "SK_CTKT",
        record_id,
        "update_execution",
        {"before": before, "after": model_to_dict(record)},
    )

    # Notify real author / proxy submitter when someone else updates execution status.
    recipients = [uid for uid in _owner_recipient_ids(db, record) if uid != actor]
    if recipients:
        notif_payload = {
            "id": record.id,
            "sk_code": record.sk_code,
            "status": record.status,
            "execution_status": execution_status,
            "completion_plan": next_plan,
            "updated_by": actor,
        }
        for uid in recipients:
            notify(db, "SK_EXECUTION_UPDATED", notif_payload, recipient_user_id=uid)

    db.commit()
    db.refresh(record)
    return record
