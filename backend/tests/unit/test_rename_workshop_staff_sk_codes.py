from datetime import datetime, timezone

from app.models.domain import NotificationModel, SKCTKTModel, SKCodeSequenceModel
from scripts.rename_workshop_staff_sk_codes import rename_workshop_staff_sk_codes


def test_rename_workshop_staff_sk_codes_is_idempotent(db_session):
    rec = SKCTKTModel(
        id="sk-ws-1",
        sk_code="FI/06/2026-Workshop_Staff-01",
        title="Cải tiến XQL",
        author_name="Mai Thái Bảo",
        author_user_id="baomt",
        team="Workshop_Staff",
        content_description="Nội dung",
        completion_plan="Dự kiến T12/2026",
        status="Submitted",
        status_history=[],
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        revision=1,
    )
    seq = SKCodeSequenceModel(prefix="FI/06/2026-Workshop_Staff", next_value=2)
    notif = NotificationModel(
        id="notif-ws-1",
        recipient_user_id="baomt",
        recipient_role=None,
        event="SK_SUBMITTED",
        payload={"id": "sk-ws-1", "sk_code": "FI/06/2026-Workshop_Staff-01", "status": "Submitted"},
        read=False,
    )
    db_session.add_all([rec, seq, notif])
    db_session.commit()

    dry = rename_workshop_staff_sk_codes(db_session, apply=False)
    assert dry["dry_run"] is True
    assert len(dry["candidates"]) == 1
    assert dry["candidates"][0]["new_code"] == "FI/06/2026-XQL-01"
    assert db_session.get(SKCTKTModel, "sk-ws-1").sk_code == "FI/06/2026-Workshop_Staff-01"

    applied = rename_workshop_staff_sk_codes(db_session, apply=True)
    assert applied["dry_run"] is False
    assert applied["renamed_ids"] == ["sk-ws-1"]
    assert applied["updated_sequences"] == 1
    assert applied["updated_notifications"] == 1
    assert db_session.get(SKCTKTModel, "sk-ws-1").sk_code == "FI/06/2026-XQL-01"
    assert db_session.get(SKCTKTModel, "sk-ws-1").team == "Workshop_Staff"
    assert db_session.get(SKCodeSequenceModel, "FI/06/2026-XQL").next_value == 2
    assert db_session.get(SKCodeSequenceModel, "FI/06/2026-Workshop_Staff") is None
    assert db_session.get(NotificationModel, "notif-ws-1").payload["sk_code"] == "FI/06/2026-XQL-01"

    again = rename_workshop_staff_sk_codes(db_session, apply=True)
    assert again["candidates"] == []
    assert again["renamed_ids"] == []
