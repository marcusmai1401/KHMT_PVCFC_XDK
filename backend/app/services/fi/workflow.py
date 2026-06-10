from dataclasses import dataclass
from enum import StrEnum


class SKStatus(StrEnum):
    DRAFT = "Draft"
    SUBMITTED = "Submitted"
    NEED_MORE_INFO = "NeedMoreInfo"
    REVIEWED = "Reviewed"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    DEFERRED = "Deferred"
    CANCELLED = "Cancelled"
    COMPLETED = "Completed"


class FIAction(StrEnum):
    SUBMIT = "submit"
    REQUEST_INFO = "request_info"
    REVIEW = "review"
    APPROVE = "approve"
    REJECT = "reject"
    DEFER = "defer"
    CANCEL = "cancel"
    COMPLETE = "complete"


TRANSITIONS = {
    (SKStatus.DRAFT, FIAction.SUBMIT): SKStatus.SUBMITTED,
    (SKStatus.DRAFT, FIAction.CANCEL): SKStatus.CANCELLED,
    # Backward-compatible no-op for older clients that still call /submit after
    # the create endpoint has already presented the SK for review.
    (SKStatus.SUBMITTED, FIAction.SUBMIT): SKStatus.SUBMITTED,
    (SKStatus.SUBMITTED, FIAction.REQUEST_INFO): SKStatus.NEED_MORE_INFO,
    (SKStatus.SUBMITTED, FIAction.REVIEW): SKStatus.REVIEWED,
    (SKStatus.SUBMITTED, FIAction.APPROVE): SKStatus.APPROVED,
    (SKStatus.SUBMITTED, FIAction.REJECT): SKStatus.REJECTED,
    (SKStatus.SUBMITTED, FIAction.DEFER): SKStatus.DEFERRED,
    (SKStatus.NEED_MORE_INFO, FIAction.SUBMIT): SKStatus.SUBMITTED,
    (SKStatus.NEED_MORE_INFO, FIAction.CANCEL): SKStatus.CANCELLED,
    (SKStatus.REVIEWED, FIAction.APPROVE): SKStatus.APPROVED,
    (SKStatus.REVIEWED, FIAction.REJECT): SKStatus.REJECTED,
    (SKStatus.REVIEWED, FIAction.DEFER): SKStatus.DEFERRED,
    (SKStatus.REVIEWED, FIAction.CANCEL): SKStatus.CANCELLED,
    (SKStatus.APPROVED, FIAction.APPROVE): SKStatus.APPROVED,
    (SKStatus.APPROVED, FIAction.DEFER): SKStatus.DEFERRED,
    (SKStatus.APPROVED, FIAction.REJECT): SKStatus.REJECTED,
    (SKStatus.DEFERRED, FIAction.APPROVE): SKStatus.APPROVED,
    (SKStatus.DEFERRED, FIAction.DEFER): SKStatus.DEFERRED,
    (SKStatus.DEFERRED, FIAction.REJECT): SKStatus.REJECTED,
    (SKStatus.REJECTED, FIAction.APPROVE): SKStatus.APPROVED,
    (SKStatus.REJECTED, FIAction.DEFER): SKStatus.DEFERRED,
    (SKStatus.REJECTED, FIAction.REJECT): SKStatus.REJECTED,
    (SKStatus.APPROVED, FIAction.COMPLETE): SKStatus.COMPLETED,
}

ROLE_ACTIONS = {
    "Team_Account": {FIAction.SUBMIT, FIAction.CANCEL},
    "Staff": {FIAction.SUBMIT, FIAction.CANCEL},
    # FI_Coordinator vừa là tác giả của TBHTĐK (đăng ký SK cho team mình)
    # vừa là người xét duyệt FI toàn xưởng.
    "FI_Coordinator": {
        FIAction.SUBMIT,
        FIAction.CANCEL,
        FIAction.REQUEST_INFO,
        FIAction.REVIEW,
        FIAction.APPROVE,
        FIAction.DEFER,
        FIAction.REJECT,
        FIAction.COMPLETE,
    },
    "Workshop_Leader": set(),
    "Admin": set(FIAction),
}


@dataclass(frozen=True)
class TransitionResult:
    from_status: SKStatus
    to_status: SKStatus
    action: FIAction


def next_status(current: str, action: str, role: str, decision_note: str | None = None) -> TransitionResult:
    current_status = SKStatus(current)
    action_enum = FIAction(action)
    if action_enum not in ROLE_ACTIONS.get(role, set()):
        raise PermissionError("Tài khoản không có quyền thực hiện thao tác này")
    if action_enum in {FIAction.REJECT, FIAction.DEFER, FIAction.CANCEL}:
        if not decision_note or not decision_note.strip():
            raise ValueError("Cần nhập ghi chú khi từ chối, xem xét sau hoặc hủy")
    try:
        target = TRANSITIONS[(current_status, action_enum)]
    except KeyError as exc:
        raise ValueError("Không thể chuyển trạng thái theo thao tác này") from exc
    return TransitionResult(current_status, target, action_enum)


def is_public_status(status: str) -> bool:
    return status in {SKStatus.APPROVED.value, SKStatus.COMPLETED.value}
