from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.services.fi.service import (
    _fi_export_record_matches,
    _fi_person_filter_matches,
    assign_khmt,
    build_fi_report_export_filters,
    can_view_sk,
    clear_khmt,
    count_for_okr,
    create_sk_ctkt,
    fi_dashboard,
    transition_sk_ctkt,
    update_sk_ctkt,
)
from app.models.domain import NotificationModel, SKCTKTModel, User
from app.services.fi.auto_completion import apply_completion_schedule, factory_today
from sqlalchemy import select


def test_person_filter_matches_imported_author_with_extra_spacing():
    selected_keys = {"id:tuyenpv", "name:pham van tuyen:team:tbch"}

    assert _fi_person_filter_matches(
        "historical-import",
        "Phạm Văn  Tuyên",
        "TBCH",
        selected_keys,
    )
    assert not _fi_person_filter_matches(
        "historical-import",
        "Phạm Văn  Tuyên",
        "TBĐL",
        selected_keys,
    )


def test_fi_export_person_filters_match_resolved_legacy_author(db_session):
    db_session.add(
        User(
            id="trunghd",
            display_name="Hồ Đức Trung - Đội TBCH",
            full_name="Hồ Đức Trung",
            password_hash="hash",
            role="Staff",
            team="TBCH",
            is_active=True,
        )
    )
    record = SKCTKTModel(
        id="sk-legacy-export-owner",
        sk_code="HIST-TBCH-TBCH-01",
        title="Legacy export",
        author_name="Hồ Đức Trung",
        author_user_id="historical-import",
        team="TBCH",
        content_description="Content",
        completion_plan="T9/2026",
        status="Approved",
        status_history=[
            {
                "from_status": None,
                "to_status": "Approved",
                "changed_by": "deploy-import",
                "comments": {"submitted_by": "deploy-import"},
            }
        ],
        is_public=True,
        is_counted_for_okr=False,
        is_historical_import=True,
    )
    db_session.add(record)
    db_session.commit()

    assert _fi_export_record_matches(record, {"authors": {"id:trunghd"}}, db_session)
    assert _fi_export_record_matches(record, {"submitters": {"id:trunghd"}}, db_session)


def test_fi_export_filters_refine_in_khmt_by_assignment_month(db_session):
    record = SKCTKTModel(
        id="sk-khmt-month-export",
        title="KHMT month export",
        author_name="Author",
        author_user_id="author",
        team="TBCH",
        content_description="Content",
        completion_plan="T9/2026",
        status="Approved",
        status_history=[],
        consider_for_khmt=True,
        khmt_month=6,
        khmt_year=2026,
    )

    june_filters = build_fi_report_export_filters(khmt="in", khmt_periods="2026-6")
    may_filters = build_fi_report_export_filters(khmt="in", khmt_periods="2026-5")
    next_year_filters = build_fi_report_export_filters(khmt="in", khmt_periods="2027-6")

    assert _fi_export_record_matches(record, june_filters, db_session)
    assert not _fi_export_record_matches(record, may_filters, db_session)
    assert not _fi_export_record_matches(record, next_year_filters, db_session)


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
            "completion_plan": "Dự kiến hoàn thành (tương lai)",
            "completion_done": False,
            "completion_date": factory_today() + timedelta(days=30),
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

    with pytest.raises(PermissionError, match="đội/tổ của mình"):
        assign_khmt(db_session, record.id, 6, 2026, "TBĐL", "Team_Account")

    updated = assign_khmt(db_session, record.id, 6, 2026, "TBCH", "Team_Account")

    assert updated.consider_for_khmt is True
    assert updated.khmt_month == 6


def test_admin_can_assign_and_clear_khmt_for_any_team(db_session):
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

    assigned = assign_khmt(db_session, record.id, 8, 2026, "admin", "Admin")

    assert assigned.consider_for_khmt is True
    assert assigned.khmt_month == 8
    assert assigned.khmt_year == 2026

    cleared = clear_khmt(db_session, record.id, "admin", "Admin")

    assert cleared.consider_for_khmt is False
    assert cleared.khmt_month is None
    assert cleared.khmt_year is None


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


def test_author_cannot_edit_approved_sk_content(db_session):
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
    transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")

    with pytest.raises(PermissionError):
        update_sk_ctkt(db_session, record.id, {"content_description": "Không được sửa"}, "cunghv", "Staff")


def test_author_can_update_only_completion_plan_of_approved_sk(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Hữu Văn Cưng",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "Dự kiến hoàn thành 30/10/2026",
            "year": 2026,
        },
        "cunghv",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "cunghv", "Staff")
    approved = transition_sk_ctkt(db_session, record.id, "approve", "fi1", "FI_Coordinator")
    approved_at = approved.approved_at
    history_length = len(approved.status_history)
    db_session.execute(NotificationModel.__table__.delete())
    db_session.commit()

    with pytest.raises(PermissionError, match="chỉ cho cập nhật Kế hoạch hoàn thành"):
        update_sk_ctkt(
            db_session,
            record.id,
            {"title": "Đổi tên", "completion_plan": "Dự kiến hoàn thành 30/11/2026"},
            "cunghv",
            "Staff",
        )
    with pytest.raises(PermissionError, match="Chỉ tác giả"):
        update_sk_ctkt(db_session, record.id, {"completion_plan": "Dự kiến hoàn thành 30/11/2026"}, "linhln", "Staff")

    updated = update_sk_ctkt(
        db_session,
        record.id,
        {
            "completion_plan": "Đã hoàn thành 20/10/2026",
            "completion_done": True,
            "completion_date": date(2026, 10, 20),
        },
        "cunghv",
        "Staff",
    )

    assert updated.status == "Approved"
    assert updated.approved_at == approved_at
    assert updated.title == "Title"
    assert updated.completion_plan == "Đã hoàn thành 20/10/2026"
    assert updated.completed_at is not None and updated.completed_at.date() == date(2026, 10, 20)
    assert len(updated.status_history) == history_length + 1
    entry = updated.status_history[-1]
    assert entry["reason"] == "completion_plan_update"
    assert entry["from_status"] == entry["to_status"] == "Approved"
    assert entry["comments"]["previous_completion_plan"] == "Dự kiến hoàn thành 30/10/2026"
    assert entry["comments"]["completion_plan"] == "Đã hoàn thành 20/10/2026"
    # Approved content is unchanged, so reviewers are not asked to review again.
    assert db_session.execute(
        select(NotificationModel).where(NotificationModel.event == "SK_CONTENT_EDITED")
    ).first() is None

    with pytest.raises(HTTPException) as future_done:
        update_sk_ctkt(
            db_session,
            record.id,
            {"completion_plan": "Đã hoàn thành 01/01/2099", "completion_done": True, "completion_date": date(2099, 1, 1)},
            "cunghv",
            "Staff",
        )
    assert future_done.value.status_code == 400

    with pytest.raises(PermissionError, match="Chỉ tác giả"):
        update_sk_ctkt(db_session, record.id, {"title": "Admin đổi tên"}, "admin", "Admin")
    by_admin = update_sk_ctkt(
        db_session,
        record.id,
        {"completion_plan": "Đã hoàn thành 21/10/2026", "completion_done": True, "completion_date": date(2026, 10, 21)},
        "admin",
        "Admin",
    )
    assert by_admin.status == "Approved"
    assert by_admin.completion_plan == "Đã hoàn thành 21/10/2026"
    assert by_admin.status_history[-1]["changed_by"] == "admin"


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


def test_legacy_sk_content_can_be_edited_by_resolved_author_only(db_session):
    db_session.add(
        User(
            id="trunghd",
            display_name="Hồ Đức Trung - Đội TBCH",
            full_name="Hồ Đức Trung",
            password_hash="hash",
            role="Staff",
            team="TBCH",
            is_active=True,
        )
    )
    record = SKCTKTModel(
        id="sk-legacy-content-lock",
        sk_code="HIST-TBCH-TBCH-10",
        title="Legacy",
        author_name="Hồ Đức Trung",
        author_user_id="historical-import",
        team="TBCH",
        content_description="Content",
        completion_plan="T6/2026",
        status="Deferred",
        status_history=[],
        is_public=True,
        is_counted_for_okr=False,
        is_historical_import=True,
    )
    db_session.add(record)
    db_session.commit()

    updated = update_sk_ctkt(db_session, record.id, {"content_description": "Tác giả sửa legacy"}, "trunghd", "Staff")

    assert updated.content_description == "Tác giả sửa legacy"
    with pytest.raises(PermissionError, match="Chỉ tác giả"):
        update_sk_ctkt(db_session, record.id, {"content_description": "Admin sửa legacy"}, "admin", "Admin")

    updated.status = "Approved"
    db_session.commit()
    with pytest.raises(PermissionError):
        update_sk_ctkt(db_session, record.id, {"content_description": "Tác giả sửa sau Đồng ý"}, "trunghd", "Staff")


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


def test_create_sk_treats_reached_planned_date_as_done(db_session):
    planned_on = factory_today() - timedelta(days=3)
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Plan already reached",
            "content_description": "Content",
            "completion_plan": "Dự kiến hoàn thành",
            "completion_done": False,
            "completion_date": planned_on,
            "year": planned_on.year,
        },
        "u1",
    )

    assert record.completed_at is not None and record.completed_at.date() == planned_on
    assert record.completion_plan == f"Đã hoàn thành {planned_on.strftime('%d/%m/%Y')}"


def _plan_record(record_id: str, status: str, plan: str, completed_at: datetime | None = None) -> SKCTKTModel:
    return SKCTKTModel(
        id=record_id,
        sk_code=f"FI/10/2026-TBCH-{record_id}",
        title="Plan",
        author_name="A",
        author_user_id="u1",
        team="TBCH",
        content_description="Content",
        completion_plan=plan,
        status=status,
        status_history=[{"from_status": None, "to_status": status, "changed_by": "u1"}],
        completed_at=completed_at,
    )


def test_completion_schedule_follows_planned_dates(db_session):
    today = date(2026, 10, 29)
    db_session.add_all(
        [
            _plan_record("due", "Approved", "Dự kiến hoàn thành 15/09/2026"),
            _plan_record("due-today", "Submitted", "Dự kiến hoàn thành 29/10/2026"),
            _plan_record("upcoming", "Submitted", "Dự kiến hoàn thành 30/12/2026"),
            _plan_record("month", "Approved", "Chưa thực hiện\nDự kiến  T08.2026"),
            _plan_record("this-month", "Approved", "Dự kiến T10/2026"),
            _plan_record("free-text", "Approved", "Thực hiện khi dừng máy"),
            _plan_record("cancelled", "Cancelled", "Dự kiến hoàn thành 15/09/2026"),
            _plan_record(
                "future-done",
                "Submitted",
                "Đã hoàn thành 23/11/2026",
                completed_at=datetime(2026, 11, 23, tzinfo=timezone.utc),
            ),
            _plan_record(
                "done",
                "Approved",
                "Đã hoàn thành 20/10/2026",
                completed_at=datetime(2026, 10, 20, tzinfo=timezone.utc),
            ),
        ]
    )
    db_session.commit()

    assert apply_completion_schedule(db_session, today=today) == 4

    def get(record_id: str) -> SKCTKTModel:
        return db_session.get(SKCTKTModel, record_id)

    assert get("due").completion_plan == "Đã hoàn thành 15/09/2026"
    assert get("due").completed_at.date() == date(2026, 9, 15)
    assert get("due").status == "Approved"
    assert get("due-today").completed_at.date() == today
    # A month-only plan is due at the end of that month.
    assert get("month").completed_at.date() == date(2026, 8, 31)
    assert get("this-month").completed_at is None
    assert get("upcoming").completed_at is None
    assert get("free-text").completed_at is None
    assert get("cancelled").completed_at is None
    assert get("future-done").completed_at is None
    assert get("future-done").completion_plan == "Dự kiến hoàn thành 23/11/2026"
    assert get("done").completion_plan == "Đã hoàn thành 20/10/2026"

    entry = get("due").status_history[-1]
    assert entry["reason"] == "completion_auto_done"
    assert entry["changed_by"] == "system"
    assert entry["from_status"] == entry["to_status"] == "Approved"
    assert entry["comments"]["previous_completion_plan"] == "Dự kiến hoàn thành 15/09/2026"
    assert get("future-done").status_history[-1]["reason"] == "completion_auto_planned"
    assert get("due").revision == 2

    # Idempotent: nothing left to change on the same day.
    assert apply_completion_schedule(db_session, today=today) == 0
    # The upcoming plan is ticked once its date arrives, as is the corrected one.
    assert apply_completion_schedule(db_session, today=date(2026, 12, 30)) == 3
    assert get("upcoming").completed_at.date() == date(2026, 12, 30)
    assert get("future-done").completed_at.date() == date(2026, 11, 23)


def test_author_can_reset_auto_completed_plan_on_pending_sk(db_session):
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "A",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Content",
            "completion_plan": "Đã hoàn thành 01/09/2026",
            "completion_done": True,
            "completion_date": date(2026, 9, 1),
            "year": 2026,
        },
        "u1",
    )
    transition_sk_ctkt(db_session, record.id, "submit", "u1", "Team_Account")
    db_session.execute(NotificationModel.__table__.delete())
    db_session.commit()
    next_month = factory_today() + timedelta(days=31)

    updated = update_sk_ctkt(
        db_session,
        record.id,
        {"completion_plan": "Dự kiến hoàn thành", "completion_done": False, "completion_date": next_month},
        "u1",
        "Team_Account",
    )

    assert updated.status == "Submitted"
    assert updated.completed_at is None
    assert updated.status_history[-1]["reason"] == "completion_plan_update"
    # Only progress changed, so reviewers are not asked to review again.
    assert db_session.execute(
        select(NotificationModel).where(NotificationModel.event == "SK_CONTENT_EDITED")
    ).first() is None


def test_completion_schedule_skips_drafts_and_rejected_sk(db_session):
    today = date(2026, 10, 29)
    db_session.add_all(
        [
            _plan_record("draft", "Draft", "Dự kiến hoàn thành 15/09/2026"),
            _plan_record("rejected", "Rejected", "Dự kiến hoàn thành 15/09/2026"),
            _plan_record("deferred", "Deferred", "Dự kiến hoàn thành 15/09/2026"),
            _plan_record(
                "rejected-future-done",
                "Rejected",
                "Đã hoàn thành 23/11/2026",
                completed_at=datetime(2026, 11, 23, tzinfo=timezone.utc),
            ),
        ]
    )
    db_session.commit()

    assert apply_completion_schedule(db_session, today=today) == 2
    assert db_session.get(SKCTKTModel, "draft").completed_at is None
    assert db_session.get(SKCTKTModel, "rejected").completed_at is None
    assert db_session.get(SKCTKTModel, "deferred").completed_at.date() == date(2026, 9, 15)
    # A done date in the future is still corrected, whatever the decision.
    assert db_session.get(SKCTKTModel, "rejected-future-done").completion_plan == "Dự kiến hoàn thành 23/11/2026"


def _submitted_sk(db_session, actor: str = "baomt", payload: dict | None = None) -> SKCTKTModel:
    record = create_sk_ctkt(
        db_session,
        {
            "author_name": "Mai Thái Bảo",
            "team": "TBCH",
            "title": "Title",
            "content_description": "Initial",
            "completion_plan": "T6/2027",
            "year": 2026,
            **(payload or {}),
        },
        actor,
    )
    transition_sk_ctkt(db_session, record.id, "submit", actor, "Team_Account")
    return record


@pytest.mark.parametrize(
    ("action", "status"),
    [("reject", "Rejected"), ("defer", "Deferred"), ("request_info", "NeedMoreInfo")],
)
def test_author_content_edit_after_decision_resubmits_for_review(db_session, action, status):
    record = _submitted_sk(db_session)
    transition_sk_ctkt(db_session, record.id, action, "admin", "Admin", note="Cần làm rõ")
    assert db_session.get(SKCTKTModel, record.id).status == status

    updated = update_sk_ctkt(
        db_session, record.id, {"content_description": "Đã bổ sung"}, "baomt", "Team_Account"
    )

    assert updated.status == "Submitted"
    assert updated.submitted_at is not None
    entry = updated.status_history[-1]
    assert (entry["from_status"], entry["to_status"], entry["reason"]) == (status, "Submitted", "resubmitted_after_edit")


def test_progress_only_edit_after_rejection_keeps_decision(db_session):
    record = _submitted_sk(db_session)
    transition_sk_ctkt(db_session, record.id, "reject", "admin", "Admin", note="Không phù hợp")
    next_month = factory_today() + timedelta(days=31)

    updated = update_sk_ctkt(
        db_session,
        record.id,
        {"completion_plan": "Dự kiến hoàn thành", "completion_done": False, "completion_date": next_month},
        "baomt",
        "Team_Account",
    )

    assert updated.status == "Rejected"


def test_request_info_requires_note(db_session):
    record = _submitted_sk(db_session)
    with pytest.raises(ValueError):
        transition_sk_ctkt(db_session, record.id, "request_info", "admin", "Admin")


def test_decision_notifies_author_and_proxy_submitter(db_session):
    record = _submitted_sk(db_session, actor="minhvq", payload={"author_user_id": "baomt"})
    db_session.execute(NotificationModel.__table__.delete())
    db_session.commit()

    transition_sk_ctkt(db_session, record.id, "approve", "admin", "Admin")

    recipients = {
        n.recipient_user_id
        for n in db_session.execute(
            select(NotificationModel).where(NotificationModel.event == "SK_APPROVED")
        ).scalars()
    }
    assert {"baomt", "minhvq"} <= recipients


def test_decision_on_historical_import_never_notifies_import_actor(db_session):
    db_session.add(
        SKCTKTModel(
            id="legacy-1",
            sk_code="FI/05/2026-TBCH-01",
            title="Legacy",
            author_name="Nguyễn Văn Không Có",
            author_user_id="historical-import",
            team="TBCH",
            content_description="Content",
            completion_plan="",
            status="Submitted",
            status_history=[{"from_status": None, "to_status": "Submitted", "changed_by": "historical-import"}],
            is_historical_import=True,
        )
    )
    db_session.commit()

    transition_sk_ctkt(db_session, "legacy-1", "approve", "admin", "Admin")

    recipients = {
        n.recipient_user_id
        for n in db_session.execute(
            select(NotificationModel).where(NotificationModel.event == "SK_APPROVED")
        ).scalars()
    }
    assert "historical-import" not in recipients
