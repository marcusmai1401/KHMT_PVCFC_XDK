from app.services.fi.service import assign_khmt, count_for_okr, create_sk_ctkt, transition_sk_ctkt


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
