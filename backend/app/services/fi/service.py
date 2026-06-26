from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import Role
from app.models.domain import SKCTKTModel, SKCodeSequenceModel, SKImageModel
from app.services.fi.completion import (
    completion_date_to_datetime,
    completion_plan_completed_at,
    completion_plan_indicates_done,
)
from app.services.fi.workflow import FIAction, SKStatus, is_public_status, next_status
from app.services.repositories import audit, make_id, model_to_dict, notify

NON_DRAFT_STATUSES = {status.value for status in SKStatus if status != SKStatus.DRAFT}
OWNER_DELETABLE_STATUSES = {SKStatus.DRAFT.value, SKStatus.SUBMITTED.value, SKStatus.NEED_MORE_INFO.value}
REVIEWABLE_STATUSES = {
    SKStatus.SUBMITTED.value,
    SKStatus.REVIEWED.value,
    SKStatus.DEFERRED.value,
    SKStatus.APPROVED.value,
    SKStatus.REJECTED.value,
}
REVIEW_DECISION_ACTIONS = {FIAction.APPROVE.value, FIAction.DEFER.value, FIAction.REJECT.value}
HISTORICAL_REVIEW_ACTIONS = REVIEW_DECISION_ACTIONS
SHARED_CONTENT_EDIT_FIELDS = {
    "content_description",
    "completion_date",
    "completion_done",
    "completion_plan",
    "title",
}
# Người dùng được phép đứng tên đăng ký SK-CTKT.
AUTHOR_ROLES = {Role.TEAM_ACCOUNT.value, Role.STAFF.value, Role.FI_COORDINATOR.value}
# Sau khi đã gửi duyệt, tác giả vẫn được sửa nội dung nhưng phải gửi noti
# cho người xét duyệt biết để xem lại.
EDITABLE_AFTER_SUBMIT_STATUSES = {
    SKStatus.SUBMITTED.value,
    SKStatus.NEED_MORE_INFO.value,
    SKStatus.REVIEWED.value,
    SKStatus.APPROVED.value,
    SKStatus.REJECTED.value,
    SKStatus.DEFERRED.value,
}
AUTHOR_CONTENT_EDITABLE_STATUSES = {SKStatus.DRAFT.value, *EDITABLE_AFTER_SUBMIT_STATUSES}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def generate_sk_code(db: Session, team: str, year: int, month: int) -> str:
    """Sinh mã SK-CTKT theo format FI/MM/YYYY-TEAM-NN.

    Sequence được reset mỗi tháng cho từng team — ví dụ:
      * TBĐL tháng 5/2026: FI/05/2026-TBĐL-01, -02, -03 ...
      * TBĐL tháng 6/2026: lại quay về -01
      * TBCH tháng 5/2026: -01 (độc lập với TBĐL)
    """
    prefix = f"FI/{month:02d}/{year}-{team}"
    sequence = db.get(SKCodeSequenceModel, prefix)
    if sequence is None:
        sequence = SKCodeSequenceModel(prefix=prefix, next_value=1)
        db.add(sequence)
        db.flush()
    value = sequence.next_value
    sequence.next_value += 1
    return f"{prefix}-{value:02d}"


def _int_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _completed_at_from_payload(
    payload: dict[str, Any],
    *,
    fallback: datetime,
    existing: datetime | None = None,
) -> datetime | None:
    completion_done = payload.get("completion_done")
    if completion_done is not None:
        if not completion_done:
            return None
        return (
            completion_date_to_datetime(payload.get("completion_date"))
            or completion_plan_completed_at(payload.get("completion_plan"), fallback=fallback)
            or fallback
        )
    if "completion_plan" in payload:
        inferred = completion_plan_completed_at(payload.get("completion_plan"), fallback=fallback)
        if inferred is not None:
            return inferred
    return existing


def submitter_user_id(record: SKCTKTModel) -> str | None:
    history = record.status_history if isinstance(record.status_history, list) else []
    if not history:
        return None
    first = history[0] if isinstance(history[0], dict) else {}
    comments = first.get("comments") if isinstance(first.get("comments"), dict) else {}
    submitted_by = comments.get("submitted_by") or comments.get("created_by")
    return str(submitted_by or first.get("changed_by") or "") or None


def is_author_or_submitter(record: SKCTKTModel, actor: str) -> bool:
    return record.author_user_id == actor or submitter_user_id(record) == actor


def create_sk_ctkt(
    db: Session,
    payload: dict[str, Any],
    actor: str,
    *,
    submit_immediately: bool = False,
) -> SKCTKTModel:
    now = _utc_now()
    team = payload["team"]
    year = _int_or_default(payload.get("year") or payload.get("registration_year"), now.year)
    registration_month = _int_or_default(payload.get("registration_month"), now.month)
    if registration_month < 1 or registration_month > 12:
        registration_month = now.month
    registration_year = _int_or_default(payload.get("registration_year"), year)
    completed_at = _completed_at_from_payload(payload, fallback=now)
    initial_status = SKStatus.SUBMITTED if submit_immediately else SKStatus.DRAFT
    record = SKCTKTModel(
        id=make_id("sk"),
        sk_code=generate_sk_code(db, team, registration_year, registration_month),
        title=payload["title"],
        author_name=payload["author_name"],
        author_user_id=payload.get("author_user_id") or actor,
        team=team,
        content_description=payload["content_description"],
        completion_plan=payload["completion_plan"],
        status=initial_status.value,
        status_history=[
            {
                "from_status": None,
                "to_status": initial_status.value,
                "changed_by": actor,
                "changed_at": now.isoformat(),
                "reason": "web_registration",
                "comments": {
                    "registration_month": registration_month,
                    "registration_year": registration_year,
                    "source": "web",
                    "submitted_by": actor,
                },
            }
        ],
        consider_for_khmt=False,
        is_public=False,
        is_counted_for_okr=False,
        is_historical_import=False,
        created_at=now,
        updated_at=now,
        submitted_at=now if submit_immediately else None,
        completed_at=completed_at,
    )
    db.add(record)
    audit(db, actor, "SK_CTKT", record.id, "create", model_to_dict(record))
    if submit_immediately:
        _notify_transition(db, record, record.id)
    db.commit()
    db.refresh(record)
    return record


def can_view_sk(record: SKCTKTModel, principal: dict[str, str]) -> bool:
    """Quyền xem SK trong danh sách private /fi/sk-ctkt.

    Mọi role trong module FI được xem toàn bộ SK đã gửi/legacy để tra cứu liên đội.
    Bản nháp vẫn chỉ hiện cho chính tác giả, vì đó chưa phải thông tin FI đã công bố.
    """
    role = principal["role"]
    user_id = principal["user_id"]
    allowed_roles = {
        Role.ADMIN.value,
        Role.FI_COORDINATOR.value,
        Role.WORKSHOP_LEADER.value,
        Role.TEAM_ACCOUNT.value,
        Role.STAFF.value,
    }
    if role not in allowed_roles:
        return False
    if record.status == SKStatus.DRAFT.value:
        return is_author_or_submitter(record, user_id)
    return True


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
    if record.is_historical_import:
        raise PermissionError("FI legacy chỉ dùng để tra cứu lịch sử, không chỉnh sửa nội dung")
    if not is_author_or_submitter(record, actor):
        raise PermissionError("Chỉ tác giả hoặc người gửi hộ mới được chỉnh sửa")
    if record.status in {SKStatus.CANCELLED.value, SKStatus.COMPLETED.value}:
        raise PermissionError("SK đã hoàn tất hoặc đã hủy, không chỉnh sửa được nội dung")
    if record.status not in AUTHOR_CONTENT_EDITABLE_STATUSES:
        raise PermissionError("Trạng thái hiện tại không cho phép chỉnh sửa nội dung")
    if not shared_content_edit:
        raise PermissionError("Tác giả chỉ được cập nhật tiêu đề, nội dung đăng ký và kế hoạch thực hiện")
    before = model_to_dict(record)
    if "team" in payload and payload["team"] != record.team:
        raise PermissionError("Tài khoản không được đổi đội/tổ của SK")
    previous_status = record.status
    for field in ["title", "content_description", "completion_plan"]:
        if field in payload:
            setattr(record, field, payload[field])
    if {"completion_plan", "completion_done", "completion_date"} & requested_fields:
        record.completed_at = _completed_at_from_payload(
            payload,
            fallback=record.created_at or _utc_now(),
            existing=record.completed_at,
        )
    record.updated_at = _utc_now()
    audit(db, actor, "SK_CTKT", record_id, "update", {"before": before, "after": model_to_dict(record)})
    # Nếu tác giả chỉnh sửa SK đã gửi duyệt thì gửi noti cho FI_Coordinator +
    # Admin để xét duyệt lại.
    if previous_status in EDITABLE_AFTER_SUBMIT_STATUSES:
        _notify_content_edit(db, record, actor)
    db.commit()
    db.refresh(record)
    return record


def _notify_content_edit(db: Session, record: SKCTKTModel, actor: str) -> None:
    payload = {
        "id": record.id,
        "sk_code": record.sk_code,
        "status": record.status,
        "team": record.team,
        "edited_by": actor,
    }
    notify(db, "SK_CONTENT_EDITED", payload, recipient_role=Role.FI_COORDINATOR.value)
    notify(db, "SK_CONTENT_EDITED", payload, recipient_role=Role.ADMIN.value)


def _validate_actor_for_transition(record: SKCTKTModel, action: str, actor: str, role: str) -> None:
    if action in {FIAction.SUBMIT.value, FIAction.CANCEL.value} and role in AUTHOR_ROLES:
        if not is_author_or_submitter(record, actor):
            raise PermissionError("Chỉ tài khoản tạo SK mới được thực hiện thao tác này")
        if action == FIAction.SUBMIT.value and record.status not in {
            SKStatus.DRAFT.value,
            SKStatus.NEED_MORE_INFO.value,
            SKStatus.SUBMITTED.value,
        }:
            raise PermissionError("Chỉ gửi duyệt được SK ở trạng thái Nháp hoặc Cần bổ sung")
        if action == FIAction.CANCEL.value and record.status not in {
            SKStatus.DRAFT.value,
            SKStatus.NEED_MORE_INFO.value,
        }:
            raise PermissionError("Chỉ hủy được SK ở trạng thái Nháp hoặc Cần bổ sung")
    if role == Role.FI_COORDINATOR.value and action in REVIEW_DECISION_ACTIONS:
        if record.status not in REVIEWABLE_STATUSES:
            raise PermissionError(
                "Chỉ đánh giá được SK ở trạng thái Chờ xét duyệt, Đã xem xét, Xem xét sau, Đồng ý hoặc Không đồng ý"
            )
        # Tránh xung đột lợi ích: Đầu mối FI không được xét duyệt SK do chính mình đăng ký.
        # Admin sẽ là người xét duyệt cho các SK của FI_Coordinator.
        if record.author_user_id == actor or submitter_user_id(record) == actor:
            raise PermissionError(
                "Đầu mối FI không được xét duyệt SK do chính mình đứng tên hoặc gửi hộ — vui lòng để Admin xét duyệt"
            )


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
    if action == FIAction.SUBMIT.value and record.status == SKStatus.SUBMITTED.value:
        _validate_actor_for_transition(record, action, actor, role)
        return record
    if record.is_historical_import:
        if action not in HISTORICAL_REVIEW_ACTIONS or record.status not in REVIEWABLE_STATUSES:
            raise PermissionError("FI legacy chỉ cho đánh giá các mục Chờ xét duyệt, Xem xét sau, Đồng ý hoặc Không đồng ý")
    _validate_actor_for_transition(record, action, actor, role)
    result = next_status(record.status, action, role, note)
    before = record.status
    now = _utc_now()
    record.status = result.to_status.value
    record.is_public = is_public_status(record.status)
    if comments and action == FIAction.REVIEW.value:
        record.fi_coordinator_comments = comments
    if action in REVIEW_DECISION_ACTIONS:
        record.decision_note = note.strip() if note and note.strip() else None
    elif note:
        record.decision_note = note
    if record.is_historical_import:
        record.consider_for_khmt = (
            record.status in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
            and record.khmt_month is not None
            and record.khmt_year is not None
        )
        record.is_counted_for_okr = record.consider_for_khmt
    if record.status == SKStatus.SUBMITTED.value:
        record.submitted_at = now
    elif record.status == SKStatus.REVIEWED.value:
        record.reviewed_at = now
    elif record.status == SKStatus.APPROVED.value:
        record.approved_at = now
    elif record.status == SKStatus.COMPLETED.value:
        record.completed_at = now
    if before == SKStatus.APPROVED.value and record.status not in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}:
        record.approved_at = None
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
        notify(db, "SK_SUBMITTED", payload, recipient_role=Role.ADMIN.value)
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


def assign_khmt(
    db: Session,
    record_id: str,
    month: int,
    year: int,
    actor: str,
    role: str = Role.ADMIN.value,
    principal_team: str | None = None,
) -> SKCTKTModel:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    if month < 1 or month > 12:
        raise ValueError("Tháng KHMT phải nằm trong khoảng 1-12")
    if year < 2020 or year > 2100:
        raise ValueError("Năm KHMT không hợp lệ")
    _ensure_khmt_editable(record, actor, role, principal_team)
    record.khmt_month = month
    record.khmt_year = year
    record.consider_for_khmt = True
    record.is_counted_for_okr = True
    now = _utc_now()
    history = {
        "from_status": record.status,
        "to_status": record.status,
        "changed_by": actor,
        "changed_at": now.isoformat(),
        "reason": "khmt_assignment",
        "comments": {
            "khmt_month": month,
            "khmt_year": year,
            "source": "workflow",
        },
    }
    record.status_history = [*record.status_history, history]
    record.updated_at = now
    audit(db, actor, "SK_CTKT", record_id, "assign_khmt", {"month": month, "year": year})
    db.commit()
    db.refresh(record)
    return record


def clear_khmt(
    db: Session,
    record_id: str,
    actor: str,
    role: str = Role.ADMIN.value,
    principal_team: str | None = None,
) -> SKCTKTModel:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    _ensure_khmt_editable(record, actor, role, principal_team)
    previous_month = record.khmt_month
    previous_year = record.khmt_year
    record.khmt_month = None
    record.khmt_year = None
    record.consider_for_khmt = False
    record.is_counted_for_okr = False
    now = _utc_now()
    history = {
        "from_status": record.status,
        "to_status": record.status,
        "changed_by": actor,
        "changed_at": now.isoformat(),
        "reason": "khmt_unassignment",
        "comments": {
            "previous_khmt_month": previous_month,
            "previous_khmt_year": previous_year,
            "source": "workflow",
        },
    }
    record.status_history = [*record.status_history, history]
    record.updated_at = now
    audit(
        db,
        actor,
        "SK_CTKT",
        record_id,
        "clear_khmt",
        {"previous_month": previous_month, "previous_year": previous_year},
    )
    db.commit()
    db.refresh(record)
    return record


def _ensure_khmt_editable(record: SKCTKTModel, actor: str, role: str, principal_team: str | None) -> None:
    if record.status not in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}:
        raise ValueError("Only Approved or Completed SK-CTKT can be assigned to KHMT")
    if role == Role.ADMIN.value:
        return
    if role != Role.TEAM_ACCOUNT.value:
        raise PermissionError("Chỉ tài khoản đội/tổ được ghi nhận tháng KHMT")
    team_code = principal_team or actor
    if record.team != team_code:
        raise PermissionError("Tài khoản đội/tổ chỉ được ghi nhận KHMT cho đội/tổ của mình")


FI_DASHBOARD_TEAMS = ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"]
FI_DASHBOARD_STATUSES = [
    SKStatus.DRAFT.value,
    SKStatus.SUBMITTED.value,
    SKStatus.NEED_MORE_INFO.value,
    SKStatus.REVIEWED.value,
    SKStatus.APPROVED.value,
    SKStatus.REJECTED.value,
    SKStatus.DEFERRED.value,
    SKStatus.CANCELLED.value,
    SKStatus.COMPLETED.value,
]
PENDING_STATUSES = {
    SKStatus.SUBMITTED.value,
    SKStatus.NEED_MORE_INFO.value,
    SKStatus.REVIEWED.value,
}
FI_REPORTABLE_STATUSES = {status for status in FI_DASHBOARD_STATUSES if status != SKStatus.DRAFT.value}
FI_EXPORT_DECISIONS = {"approved", "rejected", "deferred", "pending"}
FI_EXPORT_KHMT_FILTERS = {"in", "out"}
FI_EXPORT_COMPLETION_FILTERS = {"done", "pending"}
FI_STATUS_LABELS = {
    SKStatus.DRAFT.value: "Bản nháp",
    SKStatus.SUBMITTED.value: "Chờ xét duyệt",
    SKStatus.NEED_MORE_INFO.value: "Cần bổ sung",
    SKStatus.REVIEWED.value: "Đã xem xét",
    SKStatus.APPROVED.value: "Đã phê duyệt",
    SKStatus.REJECTED.value: "Từ chối",
    SKStatus.DEFERRED.value: "Xem xét sau",
    SKStatus.CANCELLED.value: "Đã hủy",
    SKStatus.COMPLETED.value: "Hoàn tất",
}
FI_DECISION_LABELS = {
    "approved": "Đồng ý",
    "rejected": "Không đồng ý",
    "deferred": "Xem xét sau",
    "pending": "Chưa duyệt",
}
FI_KHMT_LABELS = {"in": "Đã vào KHMT", "out": "Chưa vào KHMT"}
FI_COMPLETION_LABELS = {"done": "Đã hoàn thành", "pending": "Chưa hoàn thành"}
FI_EXPORT_DATA_HEADERS = [
    "STT",
    "Mã SK",
    "Tên SK-CTKT",
    "Tác giả",
    "Tài khoản tác giả",
    "Đội/tổ",
    "Tháng đăng ký",
    "Trạng thái",
    "Kết luận LĐX",
    "KHMT",
    "Tháng KHMT",
    "Hoàn thành",
    "Kế hoạch hoàn thành",
    "Nội dung",
    "Nhận xét FI/BM01",
    "Ghi chú quyết định",
]
FI_EXPORT_DATA_HEADER_ROW = 4


def is_fi_reportable(record: SKCTKTModel) -> bool:
    """FI dashboards/reports only count records that have been sent to FI."""
    return record.status != SKStatus.DRAFT.value


def _empty_fi_dashboard_bucket(team: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "total": 0,
        "approved": 0,
        "completed": 0,
        "deferred": 0,
        "pending": 0,
        "review_passed": 0,
        "review_failed": 0,
        "rejected": 0,
        "cancelled": 0,
        "draft": 0,
        "khmt_considered": 0,
        "khmt_not_considered": 0,
        "completed_count": 0,
        "not_completed": 0,
        "historical": 0,
        "current": 0,
        "status_counts": {status: 0 for status in FI_DASHBOARD_STATUSES},
    }
    if team is not None:
        data["team"] = team
    return data


def _is_khmt_considered(record: SKCTKTModel) -> bool:
    return bool(record.consider_for_khmt)


def _is_completion_done(record: SKCTKTModel) -> bool:
    return bool(
        record.status == SKStatus.COMPLETED.value
        or record.completed_at is not None
        or completion_plan_indicates_done(record.completion_plan)
    )


def _add_record_to_bucket(bucket: dict[str, Any], record: SKCTKTModel) -> None:
    status = record.status
    bucket["total"] += 1
    bucket["status_counts"][status] = bucket["status_counts"].get(status, 0) + 1
    if status in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}:
        bucket["approved"] += 1
        bucket["review_passed"] += 1
    if _is_completion_done(record):
        bucket["completed"] += 1
        bucket["completed_count"] += 1
    else:
        bucket["not_completed"] += 1
    if status == SKStatus.DEFERRED.value:
        bucket["deferred"] += 1
    if status in PENDING_STATUSES:
        bucket["pending"] += 1
    if status == SKStatus.REJECTED.value:
        bucket["rejected"] += 1
        bucket["review_failed"] += 1
    if status == SKStatus.CANCELLED.value:
        bucket["cancelled"] += 1
    if status == SKStatus.DRAFT.value:
        bucket["draft"] += 1
    if _is_khmt_considered(record):
        bucket["khmt_considered"] += 1
    elif status in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}:
        bucket["khmt_not_considered"] += 1
    if record.is_historical_import:
        bucket["historical"] += 1
    else:
        bucket["current"] += 1


def fi_dashboard(db: Session, principal: dict[str, str]) -> dict[str, Any]:
    # Dashboard FI là cái nhìn toàn xưởng (tổng hợp theo team/tháng), không
    # phụ thuộc người dùng nên không lọc theo can_view_sk. Mọi role có quyền
    # vào dashboard đều thấy số liệu giống nhau.
    _ = principal  # principal được giữ lại cho audit, không dùng để filter dữ liệu.
    visible_records = db.execute(
        select(SKCTKTModel).where(SKCTKTModel.status.in_(FI_REPORTABLE_STATUSES))
    ).scalars().all()
    by_team = {team: _empty_fi_dashboard_bucket(team) for team in FI_DASHBOARD_TEAMS}
    totals = _empty_fi_dashboard_bucket()
    khmt_by_month: dict[tuple[int, int], int] = {}
    for record in visible_records:
        team_bucket = by_team.setdefault(record.team, _empty_fi_dashboard_bucket(record.team))
        _add_record_to_bucket(team_bucket, record)
        _add_record_to_bucket(totals, record)
        if _is_khmt_considered(record) and record.khmt_month is not None and record.khmt_year is not None:
            key = (record.khmt_year, record.khmt_month)
            khmt_by_month[key] = khmt_by_month.get(key, 0) + 1
    return {
        "generated_at": _utc_now().isoformat(),
        "teams": list(by_team.values()),
        "totals": totals,
        "khmt_by_month": [
            {"year": year, "month": month, "count": count}
            for (year, month), count in sorted(khmt_by_month.items())
        ],
        "status_order": FI_DASHBOARD_STATUSES,
    }


def count_for_okr(db: Session, month: int, year: int) -> dict[str, int]:
    counts = {"TBHTĐK": 0, "TBCH": 0, "TBĐL": 0, "TCĐK": 0}
    records = db.execute(
        select(SKCTKTModel).where(
            SKCTKTModel.khmt_month == month,
            SKCTKTModel.khmt_year == year,
            SKCTKTModel.status.in_([SKStatus.APPROVED.value, SKStatus.COMPLETED.value]),
            SKCTKTModel.consider_for_khmt.is_(True),
            SKCTKTModel.is_counted_for_okr.is_(True),
        )
    ).scalars()
    for record in records:
        if record.team in counts:
            counts[record.team] += 1
    return counts


def build_fi_report_export_filters(
    *,
    teams: str | None = None,
    registration_months: str | None = None,
    decisions: str | None = None,
    khmt: str | None = None,
    completion: str | None = None,
) -> dict[str, set[Any]]:
    return {
        "teams": _parse_csv_values(teams),
        "registration_months": _parse_month_values(registration_months),
        "decisions": _parse_allowed_values(decisions, FI_EXPORT_DECISIONS, "decisions"),
        "khmt": _parse_allowed_values(khmt, FI_EXPORT_KHMT_FILTERS, "khmt"),
        "completion": _parse_allowed_values(completion, FI_EXPORT_COMPLETION_FILTERS, "completion"),
    }


def export_fi_reports_to_excel(db: Session, filters: dict[str, set[Any]]) -> Path:
    records = _filtered_fi_export_records(db, filters)
    workbook = Workbook()
    summary_sheet = workbook.active
    summary_sheet.title = "Tong hop"
    data_sheet = workbook.create_sheet("Du lieu FI")
    generated_at = _utc_now()

    _write_fi_export_summary(summary_sheet, records, filters, generated_at)
    _write_fi_export_rows(data_sheet, records, generated_at)
    _style_fi_export_workbook(workbook)

    export_dir = settings.storage_dir / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    filename = f"fi-reports-export-{generated_at.strftime('%Y%m%d-%H%M%S')}.xlsx"
    path = export_dir / filename
    workbook.save(path)
    return path


def _parse_csv_values(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def _parse_month_values(value: str | None) -> set[int]:
    months: set[int] = set()
    for item in _parse_csv_values(value):
        try:
            month = int(item)
        except ValueError as exc:
            raise ValueError("registration_months chỉ nhận giá trị tháng 1-12") from exc
        if month < 1 or month > 12:
            raise ValueError("registration_months chỉ nhận giá trị tháng 1-12")
        months.add(month)
    return months


def _parse_allowed_values(value: str | None, allowed: set[str], field: str) -> set[str]:
    values = _parse_csv_values(value)
    invalid = sorted(values - allowed)
    if invalid:
        raise ValueError(f"{field} không hợp lệ: {', '.join(invalid)}")
    return values


def _filtered_fi_export_records(db: Session, filters: dict[str, set[Any]]) -> list[SKCTKTModel]:
    records = db.execute(
        select(SKCTKTModel).where(SKCTKTModel.status != SKStatus.DRAFT.value)
    ).scalars().all()
    filtered = [record for record in records if _fi_export_record_matches(record, filters)]
    return sorted(filtered, key=_fi_export_sort_key)


def _fi_export_record_matches(record: SKCTKTModel, filters: dict[str, set[Any]]) -> bool:
    registration_month, _ = _fi_registration_period(record)
    teams = filters.get("teams") or set()
    months = filters.get("registration_months") or set()
    decisions = filters.get("decisions") or set()
    khmt = filters.get("khmt") or set()
    completion = filters.get("completion") or set()
    if teams and record.team not in teams:
        return False
    if months and registration_month not in months:
        return False
    if decisions and _fi_decision_filter(record) not in decisions:
        return False
    if khmt and _fi_khmt_filter(record) not in khmt:
        return False
    return not completion or _fi_completion_filter(record) in completion


def _fi_export_sort_key(record: SKCTKTModel) -> tuple[int, int, int, float]:
    registration_month, registration_year = _fi_registration_period(record)
    source_row = record.bm01_source_row or 0
    created_at = _datetime_for_sort(record.created_at)
    return (
        -(registration_year or 0),
        -(registration_month or 0),
        source_row,
        -created_at.timestamp() if created_at else 0,
    )


def _fi_registration_period(record: SKCTKTModel) -> tuple[int | None, int]:
    history = record.status_history if isinstance(record.status_history, list) else []
    first = history[0] if history and isinstance(history[0], dict) else {}
    comments = first.get("comments") if isinstance(first.get("comments"), dict) else {}
    month = _int_or_none(comments.get("registration_month"))
    year = _int_or_none(comments.get("registration_year"))
    if month is not None and 1 <= month <= 12:
        return month, year or _fallback_registration_year(record)
    created_at = _datetime_for_sort(record.created_at)
    if created_at is not None:
        return created_at.month, created_at.year
    return None, year or _utc_now().year


def _fallback_registration_year(record: SKCTKTModel) -> int:
    created_at = _datetime_for_sort(record.created_at)
    if created_at is not None:
        return created_at.year
    if record.khmt_year:
        return int(record.khmt_year)
    return _utc_now().year


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _datetime_for_sort(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _excel_datetime(value: datetime | None) -> datetime | str:
    normalized = _datetime_for_sort(value)
    return normalized.replace(tzinfo=None) if normalized else ""


def _fi_decision_filter(record: SKCTKTModel) -> str:
    if record.status in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}:
        return "approved"
    if record.status == SKStatus.REJECTED.value:
        return "rejected"
    if record.status == SKStatus.DEFERRED.value:
        return "deferred"
    return "pending"


def _fi_khmt_filter(record: SKCTKTModel) -> str:
    return "in" if record.consider_for_khmt else "out"


def _fi_completion_filter(record: SKCTKTModel) -> str:
    if record.status == SKStatus.COMPLETED.value:
        return "done"
    if record.completed_at is not None:
        return "done"
    return "done" if completion_plan_indicates_done(record.completion_plan) else "pending"


def _fi_registration_label(record: SKCTKTModel) -> str:
    month, year = _fi_registration_period(record)
    return f"T{month}/{year}" if month else "Chưa rõ"


def _fi_khmt_label(record: SKCTKTModel) -> str:
    if record.consider_for_khmt:
        return f"KHMT T{record.khmt_month}/{record.khmt_year}" if record.khmt_month and record.khmt_year else "Đã vào KHMT"
    return "Chưa vào KHMT"


def _fi_review_note(record: SKCTKTModel) -> str:
    return record.fi_coordinator_comments or record.bm01_raw_conclusion or ""


def _write_fi_export_summary(
    sheet,
    records: list[SKCTKTModel],
    filters: dict[str, set[Any]],
    generated_at: datetime,
) -> None:
    approved_count = sum(1 for record in records if _fi_decision_filter(record) == "approved")
    khmt_count = sum(1 for record in records if _fi_khmt_filter(record) == "in")
    done_count = sum(1 for record in records if _fi_completion_filter(record) == "done")

    sheet.merge_cells("A1:H1")
    sheet["A1"] = "BÁO CÁO FI/SK-CTKT"
    sheet.merge_cells("A2:H2")
    sheet["A2"] = "Dữ liệu xuất từ tab Lịch sử FI theo bộ lọc hiện tại trên website"
    sheet["A4"] = "Thời điểm xuất"
    sheet["B4"] = _excel_datetime(generated_at)
    sheet["A5"] = "Phạm vi"
    sheet["B5"] = "Không bao gồm bản nháp"
    sheet["A6"] = "Số dòng dữ liệu"
    sheet["B6"] = len(records)

    _write_summary_card(sheet, "D4", "Tổng SK", len(records), "SK-CTKT")
    _write_summary_card(sheet, "E4", "Đồng ý", approved_count, "Đạt xét duyệt")
    _write_summary_card(sheet, "F4", "Đã vào KHMT", khmt_count, "Được ghi nhận")
    _write_summary_card(sheet, "G4", "Hoàn thành", done_count, "Đã xong")

    filter_rows = [
        ("Đội/tổ", _filter_value_text(filters.get("teams"), {})),
        ("Tháng đăng ký", _filter_value_text(filters.get("registration_months"), {}, prefix="T")),
        ("Kết luận LĐX", _filter_value_text(filters.get("decisions"), FI_DECISION_LABELS)),
        ("KHMT", _filter_value_text(filters.get("khmt"), FI_KHMT_LABELS)),
        ("Hoàn thành", _filter_value_text(filters.get("completion"), FI_COMPLETION_LABELS)),
    ]
    sheet.merge_cells("A9:B9")
    sheet["A9"] = "Bộ lọc đang áp dụng"
    sheet["A10"] = "Bộ lọc"
    sheet["B10"] = "Giá trị"
    for row_index, (label, value) in enumerate(filter_rows, start=11):
        sheet.cell(row_index, 1).value = label
        sheet.cell(row_index, 2).value = value

    first_stats_row = 18
    first_group_rows = [
        _write_counter_table(
            sheet,
            first_stats_row,
            1,
            "Theo đội/tổ",
            "Đội/tổ",
            Counter(record.team for record in records),
        ),
        _write_counter_table(
            sheet,
            first_stats_row,
            4,
            "Theo tháng đăng ký",
            "Tháng",
            Counter(_fi_registration_label(record) for record in records),
        ),
        _write_counter_table(
            sheet,
            first_stats_row,
            7,
            "Theo kết luận LĐX",
            "Kết luận",
            Counter(FI_DECISION_LABELS[_fi_decision_filter(record)] for record in records),
        ),
    ]
    second_stats_row = max(first_group_rows) + 3
    _write_counter_table(
        sheet,
        second_stats_row,
        1,
        "Theo KHMT",
        "KHMT",
        Counter(FI_KHMT_LABELS[_fi_khmt_filter(record)] for record in records),
    )
    _write_counter_table(
        sheet,
        second_stats_row,
        4,
        "Theo hoàn thành",
        "Hoàn thành",
        Counter(FI_COMPLETION_LABELS[_fi_completion_filter(record)] for record in records),
    )


def _filter_value_text(values: set[Any] | None, labels: dict[str, str], *, prefix: str = "") -> str:
    if not values:
        return "Tất cả"
    rendered = []
    for value in sorted(values):
        key = str(value)
        rendered.append(labels.get(key, f"{prefix}{key}"))
    return ", ".join(rendered)


def _write_summary_card(sheet, cell_ref: str, title: str, value: int, helper: str) -> None:
    cell = sheet[cell_ref]
    cell.value = f"{title}\n{value}\n{helper}"


def _write_counter_table(sheet, start_row: int, start_col: int, title: str, label: str, counts: Counter) -> int:
    sheet.merge_cells(
        start_row=start_row,
        start_column=start_col,
        end_row=start_row,
        end_column=start_col + 1,
    )
    sheet.cell(start_row, start_col).value = title
    sheet.cell(start_row + 1, start_col).value = label
    sheet.cell(start_row + 1, start_col + 1).value = "Số lượng"
    row_index = start_row + 2
    if not counts:
        sheet.cell(row_index, start_col).value = "Không có dữ liệu"
        sheet.cell(row_index, start_col + 1).value = 0
        return row_index
    for key, count in sorted(counts.items(), key=lambda item: str(item[0])):
        sheet.cell(row_index, start_col).value = key
        sheet.cell(row_index, start_col + 1).value = count
        row_index += 1
    return row_index - 1


def _write_fi_export_rows(sheet, records: list[SKCTKTModel], generated_at: datetime) -> None:
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(FI_EXPORT_DATA_HEADERS))
    sheet["A1"] = "DANH SÁCH FI/SK-CTKT"
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(FI_EXPORT_DATA_HEADERS))
    generated_label = _excel_datetime(generated_at).strftime("%d/%m/%Y %H:%M")
    sheet["A2"] = f"Xuất lúc {generated_label} | {len(records)} SK-CTKT"
    for col_index, header in enumerate(FI_EXPORT_DATA_HEADERS, start=1):
        sheet.cell(FI_EXPORT_DATA_HEADER_ROW, col_index).value = header
    for index, record in enumerate(records, start=1):
        row_index = FI_EXPORT_DATA_HEADER_ROW + index
        row_values = [
            index,
            record.sk_code,
            record.title,
            record.author_name,
            record.author_user_id,
            record.team,
            _fi_registration_label(record),
            FI_STATUS_LABELS.get(record.status, record.status),
            FI_DECISION_LABELS[_fi_decision_filter(record)],
            _fi_khmt_label(record),
            f"T{record.khmt_month}/{record.khmt_year}" if record.khmt_month and record.khmt_year else "",
            FI_COMPLETION_LABELS[_fi_completion_filter(record)],
            record.completion_plan,
            record.content_description,
            _fi_review_note(record),
            record.decision_note or "",
        ]
        for col_index, value in enumerate(row_values, start=1):
            sheet.cell(row_index, col_index).value = value


def _style_fi_export_workbook(workbook: Workbook) -> None:
    _style_fi_summary_sheet(workbook["Tong hop"])
    _style_fi_data_sheet(workbook["Du lieu FI"])


def _style_fi_summary_sheet(sheet) -> None:
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "A9"
    sheet.sheet_properties.tabColor = "1F3A8A"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins.left = 0.25
    sheet.page_margins.right = 0.25
    sheet.page_margins.top = 0.5
    sheet.page_margins.bottom = 0.5

    title_fill = PatternFill("solid", fgColor="1F3A8A")
    subtitle_fill = PatternFill("solid", fgColor="EAF2FF")
    section_fill = PatternFill("solid", fgColor="DBEAFE")
    header_fill = PatternFill("solid", fgColor="EFF6FF")
    border = _thin_border()

    sheet["A1"].font = Font(bold=True, size=18, color="FFFFFF")
    sheet["A1"].fill = title_fill
    sheet["A1"].alignment = Alignment(horizontal="center", vertical="center")
    sheet["A2"].font = Font(italic=True, color="334155")
    sheet["A2"].fill = subtitle_fill
    sheet["A2"].alignment = Alignment(horizontal="center", vertical="center")
    sheet.row_dimensions[1].height = 30
    sheet.row_dimensions[2].height = 22

    for row in range(4, 7):
        sheet.cell(row, 1).font = Font(bold=True, color="334155")
        sheet.cell(row, 1).fill = header_fill
        sheet.cell(row, 2).fill = PatternFill("solid", fgColor="FFFFFF")
        for col in range(1, 3):
            sheet.cell(row, col).border = border
            sheet.cell(row, col).alignment = Alignment(vertical="center", wrap_text=True)
    sheet["B4"].number_format = "dd/mm/yyyy hh:mm"
    sheet["B6"].font = Font(bold=True, size=14, color="0F172A")

    for col in range(4, 8):
        cell = sheet.cell(4, col)
        cell.fill = PatternFill("solid", fgColor="F8FAFC")
        cell.font = Font(bold=True, color="0F172A")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
        sheet.column_dimensions[get_column_letter(col)].width = 17
    sheet.row_dimensions[4].height = 64

    sheet["A9"].font = Font(bold=True, color="FFFFFF")
    sheet["A9"].fill = title_fill
    sheet["A10"].font = Font(bold=True, color="0F172A")
    sheet["B10"].font = Font(bold=True, color="0F172A")
    sheet["A10"].fill = header_fill
    sheet["B10"].fill = header_fill
    for row in range(9, 16):
        for col in range(1, 3):
            sheet.cell(row, col).border = border
            sheet.cell(row, col).alignment = Alignment(vertical="top", wrap_text=True)

    for row in range(1, sheet.max_row + 1):
        for cell in sheet[row]:
            if isinstance(cell.value, datetime):
                cell.number_format = "dd/mm/yyyy hh:mm"
            if cell.value and cell.row >= 18 and cell.column <= 8:
                cell.border = border
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                if cell.row > 18 and cell.value == "Số lượng":
                    cell.alignment = Alignment(horizontal="center", vertical="center")
        row_values = [sheet.cell(row, col).value for col in range(1, 9)]
        if any(row_values) and not any(row_values[1:]):
            first_cell = sheet.cell(row, 1)
            first_cell.fill = section_fill
            first_cell.font = Font(bold=True, color="1E3A8A")
        if any(row_values) and any(value == "Số lượng" for value in row_values):
            for col in range(1, 9):
                cell = sheet.cell(row, col)
                if cell.value:
                    cell.fill = header_fill
                    cell.font = Font(bold=True, color="0F172A")
        for start_col in [1, 4, 7]:
            title_cell = sheet.cell(row, start_col)
            count_header = sheet.cell(row, start_col + 1)
            if isinstance(title_cell.value, str) and title_cell.value.startswith("Theo "):
                for col in [start_col, start_col + 1]:
                    cell = sheet.cell(row, col)
                    cell.fill = section_fill
                    cell.font = Font(bold=True, color="1E3A8A")
                    cell.border = border
                    cell.alignment = Alignment(vertical="center", wrap_text=True)
            if count_header.value == "Số lượng":
                for col in [start_col, start_col + 1]:
                    cell = sheet.cell(row, col)
                    cell.fill = header_fill
                    cell.font = Font(bold=True, color="0F172A")
                    cell.border = border
                    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    widths = {"A": 22, "B": 36, "C": 4, "D": 22, "E": 14, "F": 18, "G": 24, "H": 14}
    for column, width in widths.items():
        sheet.column_dimensions[column].width = width


def _style_fi_data_sheet(sheet) -> None:
    sheet.sheet_view.showGridLines = False
    sheet.sheet_properties.tabColor = "059669"
    sheet.freeze_panes = f"A{FI_EXPORT_DATA_HEADER_ROW + 1}"
    sheet.auto_filter.ref = f"A{FI_EXPORT_DATA_HEADER_ROW}:{get_column_letter(len(FI_EXPORT_DATA_HEADERS))}{sheet.max_row}"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins.left = 0.2
    sheet.page_margins.right = 0.2
    sheet.page_margins.top = 0.4
    sheet.page_margins.bottom = 0.4

    title_fill = PatternFill("solid", fgColor="0F766E")
    header_fill = PatternFill("solid", fgColor="1F3A8A")
    stripe_fill = PatternFill("solid", fgColor="F8FAFC")
    border = _thin_border()

    sheet["A1"].font = Font(bold=True, size=18, color="FFFFFF")
    sheet["A1"].fill = title_fill
    sheet["A1"].alignment = Alignment(horizontal="center", vertical="center")
    sheet["A2"].font = Font(italic=True, color="334155")
    sheet["A2"].fill = PatternFill("solid", fgColor="ECFDF5")
    sheet["A2"].alignment = Alignment(horizontal="center", vertical="center")
    sheet.row_dimensions[1].height = 30
    sheet.row_dimensions[2].height = 22

    for col_index in range(1, len(FI_EXPORT_DATA_HEADERS) + 1):
        cell = sheet.cell(FI_EXPORT_DATA_HEADER_ROW, col_index)
        cell.fill = header_fill
        cell.font = Font(bold=True, color="FFFFFF")
        cell.border = border
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    sheet.row_dimensions[FI_EXPORT_DATA_HEADER_ROW].height = 34

    for row_index in range(FI_EXPORT_DATA_HEADER_ROW + 1, sheet.max_row + 1):
        row_fill = stripe_fill if row_index % 2 == 0 else PatternFill(fill_type=None)
        for col_index in range(1, len(FI_EXPORT_DATA_HEADERS) + 1):
            cell = sheet.cell(row_index, col_index)
            if row_fill.fill_type:
                cell.fill = row_fill
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            if isinstance(cell.value, datetime):
                cell.number_format = "dd/mm/yyyy hh:mm"
        for col_index in [1, 6, 7, 8, 9, 10, 11, 12]:
            sheet.cell(row_index, col_index).alignment = Alignment(
                horizontal="center",
                vertical="center",
                wrap_text=True,
            )
        _apply_fi_export_tone(sheet.cell(row_index, 8), str(sheet.cell(row_index, 8).value or ""))
        _apply_fi_export_tone(sheet.cell(row_index, 9), str(sheet.cell(row_index, 9).value or ""))
        _apply_fi_export_tone(sheet.cell(row_index, 10), str(sheet.cell(row_index, 10).value or ""))
        _apply_fi_export_tone(sheet.cell(row_index, 12), str(sheet.cell(row_index, 12).value or ""))
        sheet.row_dimensions[row_index].height = 42

    widths = [
        6,
        20,
        42,
        24,
        22,
        12,
        14,
        18,
        16,
        18,
        14,
        18,
        28,
        52,
        36,
        34,
    ]
    for col_index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(col_index)].width = width


def _thin_border() -> Border:
    side = Side(style="thin", color="D9E2EC")
    return Border(left=side, right=side, top=side, bottom=side)


def _apply_fi_export_tone(cell, value: str) -> None:
    tone = _fi_export_tone(value)
    if tone is None:
        return
    fill_color, font_color = tone
    cell.fill = PatternFill("solid", fgColor=fill_color)
    cell.font = Font(bold=True, color=font_color)


def _fi_export_tone(value: str) -> tuple[str, str] | None:
    if value in {
        "Đồng ý",
        "Đã phê duyệt",
        "Hoàn tất",
        "Đã vào KHMT",
        "Đã hoàn thành",
    } or value.startswith("KHMT "):
        return "DCFCE7", "166534"
    if value in {"Không đồng ý", "Từ chối", "Đã hủy"}:
        return "FEE2E2", "991B1B"
    if value in {"Xem xét sau", "Cần bổ sung", "Chưa hoàn thành"}:
        return "FEF3C7", "92400E"
    if value in {"Chờ xét duyệt", "Đã xem xét", "Chưa duyệt"}:
        return "DBEAFE", "1E3A8A"
    if value == "Chưa vào KHMT":
        return "F1F5F9", "475569"
    return None


def delete_sk_ctkt(db: Session, record_id: str, actor: str, role: str) -> None:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    can_delete = role == Role.ADMIN.value
    if role in AUTHOR_ROLES:
        can_delete = is_author_or_submitter(record, actor) and record.status in OWNER_DELETABLE_STATUSES
    if not can_delete:
        raise PermissionError("Chỉ tác giả/người gửi hộ được xóa SK mới trình hoặc cần bổ sung; Admin được xóa SK")
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
