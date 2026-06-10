from datetime import date

import pytest

from app.services.fi.service import (
    assign_khmt,
    can_view_sk,
    clear_khmt,
    count_for_okr,
    create_sk_ctkt,
    fi_dashboard,
    transition_sk_ctkt,
    update_sk_ctkt,
)
from app.models.domain import NotificationModel, SKCTKTModel
from sqlalchemy import select


def test_sk_code_unique_per_team_month(db_session):
    payload = {
        "author_name": "A",
        "team": "TBCH",
        "title": "Title",
        "content_description": "Content",
        "completion_plan": "T6/2026",
        "registration_year": 2026,
        "registration_month": 5,
    }
    one = create_sk_ctkt(db_session, payload, "u1")
    two = create_sk_ctkt(db_session, payload, "u1")
    assert one.sk_code == "FI/05/2026-TBCH-01"
    assert two.sk_code == "FI/05/2026-TBCH-02"


def test_sk_code_sequence_resets_per_month_and_team(db_session):
    base = {
        "author_name": "A",
        "title": "Title",
        "content_description": "Content",
        "completion_plan": "T6/2026",
        "registration_year": 2026,
    }
    may_tbch_1 = create_sk_ctkt(db_session, {**base, "team": "TBCH", "registration_month": 5}, "u1")
    may_tbch_2 = create_sk_ctkt(db_session, {**base, "team": "TBCH", "registration_month": 5}, "u1")
    jun_tbch_1 = create_sk_ctkt(db_session, {**base, "team": "TBCH", "registration_month": 6}, "u1")
    may_tbdl_1 = create_sk_ctkt(db_session, {**base, "team": "TBĐL", "registration_month": 5}, "u1")
    assert may_tbch_1.sk_code == "FI/05/2026-TBCH-01"
    assert may_tbch_2.sk_code == "FI/05/2026-TBCH-02"
    assert jun_tbch_1.sk_code == "FI/06/2026-TBCH-01"
    assert may_tbdl_1.sk_code == "FI/05/2026-TBĐL-01"


def test_create_sk_stores_registration_period_in_history(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "registration_month": 6,
            "registration_year": 2026,
        },
        "TBCH",
    )
    history = record.status_history[0]
    assert record.sk_code == "FI/06/2026-TBCH-01"
    assert history["to_status"] == "Draft"
    assert history["comments"]["registration_month"] == 6
    assert history["comments"]["registration_year"] == 2026
    assert history["comments"]["source"] == "web"


def test_draft_completion_is_not_counted_until_submitted(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Already done",
            "content_description": "Content",
            "completion_plan": "Đã hoàn thành 10/05/2026",
            "completion_done": True,
            "completion_date": date(2026, 5, 10),
            "registration_month": 5,
            "registration_year": 2026,
        },
        "u1",
    )

    assert record.status == "Draft"
    assert record.completed_at is not None
    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    assert payload["totals"]["total"] == 0
    assert payload["totals"]["completed_count"] == 0
    assert payload["totals"]["not_completed"] == 0

    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")
    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    assert payload["totals"]["total"] == 1
    assert payload["totals"]["completed_count"] == 1


def test_create_sk_keeps_future_completion_plan_not_completed(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Future plan",
            "content_description": "Content",
            "completion_plan": "Dự kiến hoàn thành 10/06/2026",
            "completion_done": False,
            "completion_date": date(2026, 6, 10),
            "registration_month": 5,
            "registration_year": 2026,
        },
        "u1",
    )

    assert record.completed_at is None
    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    assert payload["totals"]["total"] == 0
    assert payload["totals"]["completed_count"] == 0
    assert payload["totals"]["not_completed"] == 0


def test_khmt_count_only_approved_with_month_year(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBĐL",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")
    transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")
    assert count_for_okr(db_session, 4, 2026)["TBĐL"] == 0
    assign_khmt(db_session, record.id, 4, 2026, "u1", "Team_Account", principal_team="TBĐL")
    assert count_for_okr(db_session, 4, 2026)["TBĐL"] == 1


def test_assign_khmt_records_history_note(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")
    transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")

    updated = assign_khmt(db_session, record.id, 5, 2026, "u1", "Team_Account", principal_team="TBCH")

    assert updated.consider_for_khmt is True
    assert updated.status_history[-1]["reason"] == "khmt_assignment"
    assert updated.status_history[-1]["comments"]["khmt_month"] == 5


def test_clear_khmt_removes_month_and_okr_count(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")
    transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")
    assign_khmt(db_session, record.id, 5, 2026, "u1", "Team_Account", principal_team="TBCH")

    updated = clear_khmt(db_session, record.id, "u1", "Team_Account", principal_team="TBCH")

    assert updated.consider_for_khmt is False
    assert updated.is_counted_for_okr is False
    assert updated.khmt_month is None
    assert updated.khmt_year is None
    assert updated.status_history[-1]["reason"] == "khmt_unassignment"
    assert updated.status_history[-1]["comments"]["previous_khmt_month"] == 5
    assert count_for_okr(db_session, 5, 2026)["TBCH"] == 0


def test_assign_khmt_allows_historical_approved_records(db_session):
    record = SKCTKTModel(
        id="sk-legacy-approved",
        sk_code="HIST-TBCH-TBCH-11",
        title="Legacy approved",
        author_name="A",
        author_user_id="historical-import",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Approved",
        status_history=[],
        is_public=True,
        is_counted_for_okr=False,
        is_historical_import=True,
    )
    db_session.add(record)
    db_session.commit()

    updated = assign_khmt(db_session, record.id, 4, 2026, "TBCH", "Team_Account")

    assert updated.consider_for_khmt is True
    assert updated.is_counted_for_okr is True
    assert updated.status_history[-1]["reason"] == "khmt_assignment"


def test_assign_khmt_rejects_historical_records_before_approval(db_session):
    record = SKCTKTModel(
        id="sk-legacy-submitted",
        sk_code="HIST-TBCH-TBCH-12",
        title="Legacy submitted",
        author_name="A",
        author_user_id="historical-import",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Submitted",
        status_history=[],
        is_public=False,
        is_counted_for_okr=False,
        is_historical_import=True,
    )
    db_session.add(record)
    db_session.commit()

    with pytest.raises(ValueError, match="Only Approved"):
        assign_khmt(db_session, record.id, 4, 2026, "TBCH", "Team_Account")


def test_team_account_assign_khmt_is_limited_to_own_team(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "TBCH",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "TBCH", "Team_Account")
    transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")

    with pytest.raises(PermissionError, match="Chỉ tài khoản đội/tổ"):
        assign_khmt(db_session, record.id, 6, 2026, "admin", "Admin")

    with pytest.raises(PermissionError, match="đội/tổ của mình"):
        assign_khmt(db_session, record.id, 6, 2026, "TBĐL", "Team_Account")

    updated = assign_khmt(db_session, record.id, 6, 2026, "TBCH", "Team_Account")

    assert updated.consider_for_khmt is True
    assert updated.khmt_month == 6


def test_fi_dashboard_aggregates_status_and_khmt(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TCĐK",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")
    transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")
    assign_khmt(db_session, record.id, 4, 2026, "u1", "Team_Account", principal_team="TCĐK")

    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    team = next(item for item in payload["teams"] if item["team"] == "TCĐK")

    assert payload["totals"]["total"] == 1
    assert payload["totals"]["approved"] == 1
    assert payload["totals"]["review_passed"] == 1
    assert payload["totals"]["review_failed"] == 0
    assert payload["totals"]["khmt_considered"] == 1
    assert payload["totals"]["khmt_not_considered"] == 0
    assert team["khmt_considered"] == 1
    assert payload["khmt_by_month"] == [{"year": 2026, "month": 4, "count": 1}]


def test_fi_dashboard_uses_explicit_khmt_flag(db_session):
    record = SKCTKTModel(
        id="sk-stale-khmt",
        sk_code="FI-2026-TBCH-0999",
        title="Stale KHMT fields",
        author_name="A",
        author_user_id="u1",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Approved",
        status_history=[],
        consider_for_khmt=False,
        khmt_month=4,
        khmt_year=2026,
        is_public=True,
        is_counted_for_okr=True,
        is_historical_import=False,
    )
    db_session.add(record)
    db_session.commit()

    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})

    assert payload["totals"]["approved"] == 1
    assert payload["totals"]["review_passed"] == 1
    assert payload["totals"]["khmt_considered"] == 0
    assert payload["totals"]["khmt_not_considered"] == 1
    assert payload["khmt_by_month"] == []
    assert count_for_okr(db_session, 4, 2026)["TBCH"] == 0


def test_fi_dashboard_mixes_historical_and_current_records(db_session):
    current = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Current approved",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, current.id, "submit", "u1", "Team_Account")
    transition_sk_ctkt(db_session, current.id, "approve", "fi1", "FI_Coordinator")
    assign_khmt(db_session, current.id, 5, 2026, "u1", "Team_Account", principal_team="TBCH")
    historical = SKCTKTModel(
        id="sk-legacy-deferred-dashboard",
        sk_code="HIST-TBCH-TBCH-07",
        title="Legacy deferred",
        author_name="A",
        author_user_id="historical-import",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Deferred",
        status_history=[],
        consider_for_khmt=False,
        is_public=False,
        is_counted_for_okr=False,
        is_historical_import=True,
    )
    db_session.add(historical)
    db_session.commit()

    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    team = next(item for item in payload["teams"] if item["team"] == "TBCH")

    assert payload["totals"]["total"] == 2
    assert payload["totals"]["historical"] == 1
    assert payload["totals"]["current"] == 1
    assert payload["totals"]["deferred"] == 1
    assert payload["totals"]["khmt_considered"] == 1
    assert team["historical"] == 1
    assert team["current"] == 1
    assert team["khmt_not_considered"] == 0


def test_fi_dashboard_tracks_review_failed_separately(db_session):
    record = SKCTKTModel(
        id="sk-rejected-dashboard",
        sk_code="FI-2026-TBCH-0998",
        title="Rejected SK",
        author_name="A",
        author_user_id="u1",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Rejected",
        status_history=[],
        is_public=False,
        is_counted_for_okr=False,
        is_historical_import=False,
    )
    db_session.add(record)
    db_session.commit()

    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    team = next(item for item in payload["teams"] if item["team"] == "TBCH")

    assert payload["totals"]["review_failed"] == 1
    assert team["review_failed"] == 1
    assert payload["totals"]["khmt_not_considered"] == 0


def test_fi_dashboard_counts_legacy_completion_plan_as_done(db_session):
    record = SKCTKTModel(
        id="sk-legacy-completed-plan",
        sk_code="HIST-TBĐL-TBĐ-06",
        title="Legacy done",
        author_name="A",
        author_user_id="historical-import",
        team="TBĐL",
        content_description="Content",
        completion_plan="Đã triển khai BDTT 2025",
        status="Approved",
        status_history=[],
        is_public=True,
        is_counted_for_okr=False,
        is_historical_import=True,
    )
    db_session.add(record)
    db_session.commit()

    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    team = next(item for item in payload["teams"] if item["team"] == "TBĐL")

    assert payload["totals"]["approved"] == 1
    assert payload["totals"]["status_counts"]["Completed"] == 0
    assert payload["totals"]["completed_count"] == 1
    assert payload["totals"]["not_completed"] == 0
    assert team["completed_count"] == 1


def test_only_author_can_edit_new_sk_content(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Hữu Văn Cưng",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "cunghv",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "cunghv", "Staff")

    with pytest.raises(PermissionError, match="Chỉ tác giả"):
        update_sk_ctkt(db_session, record.id, {"content_description": "Sai người sửa"}, "linhln", "Team_Account")

    with pytest.raises(PermissionError, match="Chỉ tác giả"):
        update_sk_ctkt(db_session, record.id, {"content_description": "Admin sửa hộ"}, "admin", "Admin")

    updated = update_sk_ctkt(db_session, record.id, {"content_description": "Tác giả sửa"}, "cunghv", "Staff")

    assert updated.content_description == "Tác giả sửa"


def test_fi_coordinator_can_set_deferred_from_submitted(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")

    updated = transition_sk_ctkt(db_session, record.id, "defer", "fi1", "FI_Coordinator", note="Cần xem xét sau")

    assert updated.status == "Deferred"
    assert updated.decision_note == "Cần xem xét sau"


def test_fi_coordinator_can_revise_approved_decision(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")
    approved = transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")
    assert approved.status == "Approved"
    assert approved.approved_at is not None

    updated = transition_sk_ctkt(db_session, record.id, "defer", "fi1", "FI_Coordinator", note="Cần bổ sung đánh giá")

    assert updated.status == "Deferred"
    assert updated.approved_at is None
    assert updated.decision_note == "Cần bổ sung đánh giá"


def test_historical_deferred_can_be_approved_by_fi_coordinator(db_session):
    record = SKCTKTModel(
        id="sk-legacy-deferred",
        sk_code="HIST-TBCH-TBCH-98",
        title="Legacy deferred",
        author_name="A",
        author_user_id="historical-import",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Deferred",
        status_history=[],
        is_public=False,
        is_counted_for_okr=False,
        is_historical_import=True,
        khmt_month=6,
        khmt_year=2026,
    )
    db_session.add(record)
    db_session.commit()

    updated = transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")

    assert updated.status == "Approved"
    assert updated.is_historical_import is True
    assert updated.is_counted_for_okr is True


def test_workshop_leader_cannot_transition_fi(db_session):
    """Workshop_Leader chỉ xem & nhận noti, không còn quyền duyệt FI."""
    record = SKCTKTModel(
        id="sk-leader-blocked",
        sk_code="FI-2026-TBCH-9999",
        title="Cần duyệt",
        author_name="A",
        author_user_id="minhvq",
        team="TBHTĐK",
        content_description="Content",
        completion_plan="T6/2026",
        status="Submitted",
        status_history=[],
        is_public=False,
        is_counted_for_okr=False,
        is_historical_import=False,
    )
    db_session.add(record)
    db_session.commit()

    import pytest

    with pytest.raises(PermissionError):
        transition_sk_ctkt(db_session, record.id, "approve", "kiaq", "Workshop_Leader")


def test_fi_coordinator_can_register_and_submit_own_sk(db_session):
    """FI_Coordinator (Phạm Thanh Quyền) cũng là tác giả SK cho team TBHTĐK."""
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Phạm Thanh Quyền",
            "team": "TBHTĐK",
            "title": "SK của FI",
            "content_description": "Nội dung do đầu mối FI đề xuất",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "quyenpt",
    )
    assert record.author_user_id == "quyenpt"

    submitted = transition_sk_ctkt(db_session, record.id, "submit", "quyenpt", "FI_Coordinator")
    assert submitted.status == "Submitted"


def test_fi_coordinator_cannot_review_own_sk(db_session):
    """FI_Coordinator không được xét duyệt SK do chính mình đăng ký (xung đột lợi ích)."""
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Phạm Thanh Quyền",
            "team": "TBHTĐK",
            "title": "SK của FI",
            "content_description": "Nội dung",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "quyenpt",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "quyenpt", "FI_Coordinator")

    with pytest.raises(PermissionError, match="chính mình"):
        transition_sk_ctkt(db_session, record.id, "approve", "quyenpt", "FI_Coordinator")

    # Admin vẫn duyệt được
    approved = transition_sk_ctkt(db_session, record.id, "approve", "admin", "Admin")
    assert approved.status == "Approved"


def test_fi_coordinator_can_review_others_sk_and_revise_decision(db_session):
    """FI_Coordinator được sửa lại nhận xét/quyết định cho SK của người khác."""
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Mai Thái Bảo",
            "team": "TBCH",
            "title": "SK TBCH",
            "content_description": "Nội dung",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "baomt",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "baomt", "Team_Account")
    first = transition_sk_ctkt(
        db_session, record.id, "approve", "quyenpt", "FI_Coordinator", note="OK"
    )
    assert first.status == "Approved"

    # Sửa lại đánh giá: chuyển thành Deferred kèm note mới
    revised = transition_sk_ctkt(
        db_session, record.id, "defer", "quyenpt", "FI_Coordinator", note="Cần xem lại"
    )
    assert revised.status == "Deferred"
    assert revised.decision_note == "Cần xem lại"


def test_submit_notifies_fi_coordinator_and_admin(db_session):
    """Khi tác giả submit SK, cả FI_Coordinator lẫn Admin đều nhận noti SK_SUBMITTED."""
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Mai Thái Bảo",
            "team": "TBCH",
            "title": "SK chờ duyệt",
            "content_description": "Nội dung",
            "completion_plan": "T6/2026",
            "registration_year": 2026,
            "registration_month": 5,
        },
        "baomt",
    )
    db_session.execute(NotificationModel.__table__.delete())
    db_session.commit()

    transition_sk_ctkt(db_session, record.id, "submit", "baomt", "Team_Account")

    notifications = db_session.execute(
        select(NotificationModel).where(NotificationModel.event == "SK_SUBMITTED")
    ).scalars().all()
    recipient_roles = {n.recipient_role for n in notifications}
    assert "FI_Coordinator" in recipient_roles
    assert "Admin" in recipient_roles


def test_author_edit_after_submit_notifies_reviewers(db_session):
    """Khi tác giả sửa SK đã submit, FI_Coordinator + Admin sẽ nhận noti SK_CONTENT_EDITED."""
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Mai Thái Bảo",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Initial",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "baomt",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "baomt", "Team_Account")

    # Xoá noti cũ trước khi edit để dễ kiểm tra
    db_session.execute(NotificationModel.__table__.delete())
    db_session.commit()

    update_sk_ctkt(
        db_session, record.id, {"content_description": "Đã chỉnh sửa"}, "baomt", "Team_Account"
    )

    notifications = db_session.execute(
        select(NotificationModel).where(NotificationModel.event == "SK_CONTENT_EDITED")
    ).scalars().all()
    recipient_roles = {n.recipient_role for n in notifications}
    assert "FI_Coordinator" in recipient_roles
    assert "Admin" in recipient_roles


def test_author_edit_draft_does_not_notify(db_session):
    """Sửa SK Draft (chưa gửi) thì không gửi noti — chưa ai duyệt cả."""
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Mai Thái Bảo",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Initial",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "baomt",
    )

    db_session.execute(NotificationModel.__table__.delete())
    db_session.commit()

    update_sk_ctkt(
        db_session, record.id, {"content_description": "Sửa lúc còn nháp"}, "baomt", "Team_Account"
    )

    notifications = db_session.execute(
        select(NotificationModel).where(NotificationModel.event == "SK_CONTENT_EDITED")
    ).scalars().all()
    assert notifications == []


def test_can_view_sk_allows_cross_team_submitted_records_but_keeps_drafts_private(db_session):
    """Mọi user FI xem được SK đã gửi của đội khác, nhưng draft vẫn riêng tư."""
    own = create_sk_ctkt(
        db_session,
        {
            "author_name": "Mai Thái Bảo",
            "team": "TBCH",
            "title": "Mine",
            "content_description": "x",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "baomt",
    )
    other = create_sk_ctkt(
        db_session,
        {
            "author_name": "Người khác",
            "team": "TBCH",
            "title": "Other",
            "content_description": "y",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "someone-else",
    )
    transition_sk_ctkt(db_session, other.id, "submit", "someone-else", "Team_Account")
    other_draft = create_sk_ctkt(
        db_session,
        {
            "author_name": "Người khác",
            "team": "TBĐL",
            "title": "Other draft",
            "content_description": "z",
            "completion_plan": "T6/2026",
            "year": 2026,
        },
        "someone-else",
    )

    principal_baomt = {"user_id": "baomt", "role": "Team_Account", "team": "TBCH"}
    assert can_view_sk(own, principal_baomt) is True
    assert can_view_sk(other, principal_baomt) is True
    assert can_view_sk(other_draft, principal_baomt) is False

    # Các role còn lại cũng chỉ thấy SK đã gửi, không thấy draft của người khác.
    for role in ("Admin", "FI_Coordinator", "Workshop_Leader"):
        principal = {"user_id": role.lower(), "role": role, "team": None}
        assert can_view_sk(own, principal) is False
        assert can_view_sk(other, principal) is True
        assert can_view_sk(other_draft, principal) is False


def test_legacy_sk_content_cannot_be_edited_even_by_author_or_admin(db_session):
    record = SKCTKTModel(
        id="sk-legacy-content-lock",
        sk_code="HIST-TBCH-TBCH-10",
        title="Legacy",
        author_name="A",
        author_user_id="baomt",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Approved",
        status_history=[],
        is_public=True,
        is_counted_for_okr=False,
        is_historical_import=True,
    )
    db_session.add(record)
    db_session.commit()

    with pytest.raises(PermissionError, match="legacy"):
        update_sk_ctkt(db_session, record.id, {"content_description": "Sửa legacy"}, "baomt", "Staff")
    with pytest.raises(PermissionError, match="legacy"):
        update_sk_ctkt(db_session, record.id, {"content_description": "Admin sửa legacy"}, "admin", "Admin")


def test_historical_approved_can_be_revised_by_fi_coordinator(db_session):
    record = SKCTKTModel(
        id="sk-legacy-approved-review",
        sk_code="HIST-TBCH-TBCH-11",
        title="Legacy approved",
        author_name="A",
        author_user_id="historical-import",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Approved",
        status_history=[],
        consider_for_khmt=True,
        is_public=True,
        is_counted_for_okr=True,
        is_historical_import=True,
        khmt_month=1,
        khmt_year=2026,
    )
    db_session.add(record)
    db_session.commit()

    updated = transition_sk_ctkt(db_session, record.id, "reject", "fi1", "FI_Coordinator", note="Không phù hợp")

    assert updated.status == "Rejected"
    assert updated.is_public is False
    assert updated.consider_for_khmt is False
    assert updated.is_counted_for_okr is False
