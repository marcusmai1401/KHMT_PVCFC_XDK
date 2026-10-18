from datetime import datetime, timezone

from app.models.domain import SKCTKTModel
from app.services.fi.service import generate_sk_code
from app.services.fi.workflow import SKStatus


def test_sequence_starts_after_legacy_code_and_does_not_reset(db_session):
    db_session.add(
        SKCTKTModel(
            id="legacy-sequence-fi",
            sk_code="FI/04/2026-TBCH-07",
            title="Legacy",
            author_name="Legacy",
            author_user_id="TBCH",
            team="TBCH",
            content_description="Legacy content",
            completion_plan="T4/2026",
            status=SKStatus.SUBMITTED.value,
            status_history=[],
            created_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()

    assert generate_sk_code(db_session, "TBCH", 2026, 4) == "FI/04/2026-TBCH-08"
    db_session.flush()
    assert generate_sk_code(db_session, "TBCH", 2026, 4) == "FI/04/2026-TBCH-09"
