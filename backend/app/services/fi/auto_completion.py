"""Keep FI completion plans consistent with the calendar.

Quy ước: khi tới ngày dự kiến, SK được coi là đã hoàn thành (tác giả sửa lại
bằng "Cập nhật tiến độ" nếu thực tế chưa xong). Ngược lại, "Đã hoàn thành" với
ngày trong tương lai là nhập nhầm, nên được đưa về "Dự kiến hoàn thành".
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.domain import SKCTKTModel
from app.services.fi.completion import _normalize, completion_date_to_datetime, completion_plan_indicates_done
from app.services.fi.workflow import SKStatus
from app.services.repositories import audit

logger = logging.getLogger(__name__)

SYSTEM_ACTOR = "system"
AUTO_DONE_REASON = "completion_auto_done"
AUTO_PLANNED_REASON = "completion_auto_planned"
# Đã hủy hoặc đã kết thúc quy trình thì không còn kế hoạch để theo dõi.
SKIPPED_STATUSES = {SKStatus.CANCELLED.value, SKStatus.COMPLETED.value}

_FULL_DATE = re.compile(r"\b(0?[1-9]|[12]\d|3[01])\s*[./-]\s*(0?[1-9]|1[0-2])\s*[./-]\s*(20\d{2})\b")
_MONTH = re.compile(r"(?:\bt|thang)?\s*(1[0-2]|0?[1-9])\s*[./-]\s*(20\d{2})\b")


def factory_today() -> date:
    # Người dùng ở Việt Nam (UTC+7).
    return (datetime.now(timezone.utc) + timedelta(hours=7)).date()


def format_plan(done: bool, value: date) -> str:
    text = value.strftime("%d/%m/%Y")
    return f"Đã hoàn thành {text}" if done else f"Dự kiến hoàn thành {text}"


def completion_plan_due_date(value: str | None) -> date | None:
    """Ngày dự kiến trong kế hoạch; kế hoạch chỉ ghi tháng thì tính tới cuối tháng."""
    text = _normalize(value)
    if not text:
        return None
    match = _FULL_DATE.search(text)
    if match:
        try:
            return date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
        except ValueError:
            return None
    match = _MONTH.search(text)
    if match:
        year, month = int(match.group(2)), int(match.group(1))
        return date(year, month, calendar.monthrange(year, month)[1])
    return None


def _local_date(value: datetime) -> date:
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return (aware.astimezone(timezone.utc) + timedelta(hours=7)).date()


def _plan_transition(record: SKCTKTModel, today: date) -> tuple[str, str, datetime | None] | None:
    if record.status in SKIPPED_STATUSES:
        return None
    if record.completed_at is not None:
        completed_on = _local_date(record.completed_at)
        if completed_on > today:
            return AUTO_PLANNED_REASON, format_plan(False, completed_on), None
        return None
    if completion_plan_indicates_done(record.completion_plan):
        return None
    due = completion_plan_due_date(record.completion_plan)
    if due is None or due > today:
        return None
    return AUTO_DONE_REASON, format_plan(True, due), completion_date_to_datetime(due)


def apply_completion_schedule(db: Session, *, today: date | None = None) -> int:
    """Áp quy ước ngày hoàn thành cho mọi SK; trả về số SK đã cập nhật."""
    today = today or factory_today()
    records = db.scalars(select(SKCTKTModel).where(SKCTKTModel.status.not_in(SKIPPED_STATUSES))).all()
    due_ids = [record.id for record in records if _plan_transition(record, today) is not None]
    # Kết thúc giao dịch đọc (giữ nguyên thay đổi đang chờ của bên gọi, vd. sandbox vừa clone).
    db.commit()
    changed = 0
    for record_id in due_ids:
        # SKIP LOCKED: SK đang được người dùng sửa sẽ được xử lý ở lượt sau.
        record = db.scalars(
            select(SKCTKTModel).where(SKCTKTModel.id == record_id).with_for_update(skip_locked=True)
        ).first()
        transition = _plan_transition(record, today) if record is not None else None
        if record is None or transition is None:
            db.rollback()
            continue
        reason, plan, completed_at = transition
        previous_plan = record.completion_plan
        previous_completed_at = record.completed_at
        now = datetime.now(timezone.utc)
        record.completion_plan = plan
        record.completed_at = completed_at
        record.revision += 1
        history: list[dict[str, Any]] = record.status_history if isinstance(record.status_history, list) else []
        record.status_history = [
            *history,
            {
                "from_status": record.status,
                "to_status": record.status,
                "changed_by": SYSTEM_ACTOR,
                "changed_at": now.isoformat(),
                "reason": reason,
                "comments": {
                    "previous_completion_plan": previous_plan,
                    "completion_plan": plan,
                    "previous_completed_at": previous_completed_at.isoformat() if previous_completed_at else None,
                    "completed_at": completed_at.isoformat() if completed_at else None,
                },
            },
        ]
        audit(
            db,
            SYSTEM_ACTOR,
            "SK_CTKT",
            record.id,
            reason,
            {"previous_completion_plan": previous_plan, "completion_plan": plan},
        )
        db.commit()
        changed += 1
    db.commit()
    if changed:
        logger.info("FI completion schedule updated %s record(s)", changed)
    return changed
