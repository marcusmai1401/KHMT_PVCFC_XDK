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


def test_xql_sequence_continues_after_legacy_workshop_staff_codes(db_session):
    """Mã XQL mới không được trùng với mã Workshop_Staff cũ sau khi chạy script đổi mã."""
    from app.models.domain import SKCodeSequenceModel

    db_session.add_all(
        [
            SKCTKTModel(
                id="legacy-ws-code",
                sk_code="FI/11/2026-Workshop_Staff-02",
                title="Legacy XQL",
                author_name="Legacy",
                author_user_id="baomt",
                team="Workshop_Staff",
                content_description="Legacy content",
                completion_plan="T11/2026",
                status=SKStatus.SUBMITTED.value,
                status_history=[],
                created_at=datetime.now(timezone.utc),
            ),
            SKCodeSequenceModel(prefix="FI/11/2026-Workshop_Staff", next_value=4),
        ]
    )
    db_session.commit()

    # Sequence cũ đã cấp tới -03 (next_value=4) nên mã XQL mới phải bắt đầu từ -04.
    assert generate_sk_code(db_session, "Workshop_Staff", 2026, 11) == "FI/11/2026-XQL-04"
    db_session.flush()
    assert generate_sk_code(db_session, "Workshop_Staff", 2026, 11) == "FI/11/2026-XQL-05"
