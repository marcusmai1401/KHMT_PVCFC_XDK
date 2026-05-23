from app.services.fi.service import assign_khmt, count_for_okr, create_sk_ctkt, transition_sk_ctkt
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
