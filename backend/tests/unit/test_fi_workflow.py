import pytest

from app.services.fi.workflow import is_public_status, next_status


def test_valid_fi_transition_chain():
    assert next_status("Draft", "submit", "Team_Account").to_status.value == "Submitted"
    assert next_status("Submitted", "approve", "FI_Coordinator").to_status.value == "Approved"
    assert next_status("Approved", "complete", "FI_Coordinator").to_status.value == "Completed"


def test_fi_can_approve_directly_from_submitted():
    assert next_status("Submitted", "approve", "FI_Coordinator").to_status.value == "Approved"


def test_fi_can_approve_deferred():
    assert next_status("Deferred", "approve", "FI_Coordinator").to_status.value == "Approved"


def test_fi_can_reject_from_submitted_with_note():
    assert next_status("Submitted", "reject", "FI_Coordinator", decision_note="Không đủ thông tin").to_status.value == "Rejected"


def test_fi_reject_requires_note():
    with pytest.raises(ValueError):
        next_status("Submitted", "reject", "FI_Coordinator")


def test_invalid_transition_rejected():
    with pytest.raises(ValueError):
        next_status("Draft", "approve", "FI_Coordinator")


def test_workshop_leader_cannot_review_fi():
    """Workshop_Leader chỉ xem & nhận noti; mọi action duyệt FI đều bị từ chối."""
    with pytest.raises(PermissionError):
        next_status("Submitted", "approve", "Workshop_Leader")
    with pytest.raises(PermissionError):
        next_status("Deferred", "approve", "Workshop_Leader")
    with pytest.raises(PermissionError):
        next_status("Submitted", "reject", "Workshop_Leader", decision_note="Không phù hợp")


def test_staff_can_submit_and_cancel_like_team_account():
    """Staff đăng ký FI giống Team_Account."""
    assert next_status("Draft", "submit", "Staff").to_status.value == "Submitted"
    assert next_status("Draft", "cancel", "Staff", decision_note="Sai nội dung").to_status.value == "Cancelled"
    with pytest.raises(PermissionError):
        next_status("Submitted", "approve", "Staff")


def test_decision_note_required_for_reject():
    with pytest.raises(ValueError):
        next_status("Submitted", "reject", "FI_Coordinator")
    assert next_status("Submitted", "reject", "FI_Coordinator", decision_note="Không đủ thông tin").to_status.value == "Rejected"


def test_public_visibility():
    assert is_public_status("Approved")
    assert is_public_status("Completed")
    assert not is_public_status("Submitted")
