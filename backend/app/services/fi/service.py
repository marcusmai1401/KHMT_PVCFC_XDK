from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

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
OWNER_DELETABLE_STATUSES = {SKStatus.DRAFT.value}
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


def create_sk_ctkt(db: Session, payload: dict[str, Any], actor: str) -> SKCTKTModel:
    now = _utc_now()
    team = payload["team"]
    year = _int_or_default(payload.get("year") or payload.get("registration_year"), now.year)
    registration_month = _int_or_default(payload.get("registration_month"), now.month)
    if registration_month < 1 or registration_month > 12:
        registration_month = now.month
    registration_year = _int_or_default(payload.get("registration_year"), year)
    completed_at = _completed_at_from_payload(payload, fallback=now)
    record = SKCTKTModel(
        id=make_id("sk"),
        sk_code=generate_sk_code(db, team, registration_year, registration_month),
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
        completed_at=completed_at,
    )
    db.add(record)
    audit(db, actor, "SK_CTKT", record.id, "create", model_to_dict(record))
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
        return record.author_user_id == user_id
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
    if record.author_user_id != actor:
        raise PermissionError("Chỉ tác giả của SK mới được chỉnh sửa")
    if record.status in {SKStatus.CANCELLED.value, SKStatus.COMPLETED.value}:
        raise PermissionError("SK đã hoàn tất hoặc đã hủy, không chỉnh sửa được nội dung")
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
    if role == Role.FI_COORDINATOR.value and action in REVIEW_DECISION_ACTIONS:
        if record.status not in REVIEWABLE_STATUSES:
            raise PermissionError(
                "Chỉ đánh giá được SK ở trạng thái Chờ xét duyệt, Đã xem xét, Xem xét sau, Đồng ý hoặc Không đồng ý"
            )
        # Tránh xung đột lợi ích: Đầu mối FI không được xét duyệt SK do chính mình đăng ký.
        # Admin sẽ là người xét duyệt cho các SK của FI_Coordinator.
        if record.author_user_id == actor:
            raise PermissionError(
                "Đầu mối FI không được xét duyệt SK do chính mình đăng ký — vui lòng để Admin xét duyệt"
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
    if role != Role.TEAM_ACCOUNT.value:
        raise PermissionError("Chỉ tài khoản đội/tổ được ghi nhận tháng KHMT")
    team_code = principal_team or actor
    if record.team != team_code:
        raise PermissionError("Tài khoản đội/tổ chỉ được ghi nhận KHMT cho đội/tổ của mình")
    if record.status not in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}:
        raise ValueError("Only Approved or Completed SK-CTKT can be assigned to KHMT")
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


def delete_sk_ctkt(db: Session, record_id: str, actor: str, role: str) -> None:
    record = db.get(SKCTKTModel, record_id)
    if record is None:
        raise KeyError("SK-CTKT not found")
    can_delete = role == Role.ADMIN.value
    if role in AUTHOR_ROLES:
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
