import pytest

from app.services.fi.service import assign_khmt, count_for_okr, create_sk_ctkt, fi_dashboard, transition_sk_ctkt
from app.models.domain import SKCTKTModel


def test_sk_code_unique_per_team_year(db_session):
    payload = {
        "author_name": "A",
        "team": "TBCH",
        "title": "Title",
        "content_description": "Content",
        "completion_plan": "T6/2026",
        "year": 2026,
    }
    one = create_sk_ctkt(db_session, payload, "u1")
    two = create_sk_ctkt(db_session, payload, "u1")
    assert one.sk_code == "FI-2026-TBCH-0001"
    assert two.sk_code == "FI-2026-TBCH-0002"


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
    assert record.sk_code == "FI-2026-TBCH-0001"
    assert history["to_status"] == "Draft"
    assert history["comments"]["registration_month"] == 6
    assert history["comments"]["registration_year"] == 2026
    assert history["comments"]["source"] == "web"


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
    assign_khmt(db_session, record.id, 4, 2026, "admin")
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

    updated = assign_khmt(db_session, record.id, 5, 2026, "admin")

    assert updated.consider_for_khmt is True
    assert updated.status_history[-1]["reason"] == "khmt_assignment"
    assert updated.status_history[-1]["comments"]["khmt_month"] == 5


def test_assign_khmt_rejects_historical_records(db_session):
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

    with pytest.raises(ValueError, match="legacy"):
        assign_khmt(db_session, record.id, 4, 2026, "admin")


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
    assign_khmt(db_session, record.id, 4, 2026, "admin")

    payload = fi_dashboard(db_session, {"user_id": "admin", "role": "Admin"})
    team = next(item for item in payload["teams"] if item["team"] == "TCĐK")

    assert payload["totals"]["total"] == 1
    assert payload["totals"]["approved"] == 1
    assert payload["totals"]["khmt_considered"] == 1
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
    assign_khmt(db_session, current.id, 5, 2026, "admin")
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
    assert team["khmt_not_considered"] == 1


def test_historical_deferred_can_be_approved_by_workshop_leader(db_session):
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

    updated = transition_sk_ctkt(db_session, record.id, "approve", "leader", "Workshop_Leader")

    assert updated.status == "Approved"
    assert updated.is_historical_import is True
    assert updated.is_counted_for_okr is True
