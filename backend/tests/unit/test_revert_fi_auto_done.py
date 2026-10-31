from datetime import datetime, timezone

from app.models.domain import SKCTKTModel
from scripts.revert_fi_auto_done import revert_auto_done


def _auto_done_record(record_id: str, status: str, *, later: list[dict] | None = None, plan: str = "Đã hoàn thành 15/09/2026"):
    # Shape written by the completion schedule before it skipped drafts/rejected SK.
    auto_entry = {
        "from_status": status,
        "to_status": status,
        "changed_by": "system",
        "changed_at": "2026-10-29T01:00:00+00:00",
        "reason": "completion_auto_done",
        "comments": {
            "previous_completion_plan": "Dự kiến hoàn thành 15/09/2026",
            "completion_plan": "Đã hoàn thành 15/09/2026",
            "previous_completed_at": None,
            "completed_at": "2026-09-15T00:00:00+00:00",
        },
    }
    return SKCTKTModel(
        id=record_id,
        sk_code=f"FI/09/2026-TBCH-{record_id}",
        title="Plan",
        author_name="A",
        author_user_id="u1",
        team="TBCH",
        content_description="Content",
        completion_plan=plan,
        status=status,
        status_history=[{"from_status": None, "to_status": status, "changed_by": "u1"}, auto_entry, *(later or [])],
        completed_at=datetime(2026, 9, 15, tzinfo=timezone.utc),
        revision=2,
    )


def test_revert_restores_plan_only_where_the_auto_tick_is_untouched(db_session):
    db_session.add_all(
        [
            _auto_done_record("rejected", "Rejected"),
            _auto_done_record("draft", "Draft"),
            # Still in review: the schedule keeps ticking these, so leave them.
            _auto_done_record("deferred", "Deferred"),
            # The author confirmed progress afterwards.
            _auto_done_record("confirmed", "Rejected", later=[{"reason": "completion_plan_update", "comments": {}}]),
            # The plan was rewritten by a content edit after the tick.
            _auto_done_record("edited", "Rejected", plan="Đã hoàn thành 01/09/2026"),
            # Rejected after the tick (status change entries do not count as plan changes).
            _auto_done_record("rejected-later", "Rejected", later=[{"from_status": "Submitted", "to_status": "Rejected", "reason": "Không phù hợp"}]),
        ]
    )
    db_session.commit()

    dry_run = revert_auto_done(db_session, apply=False)
    assert dry_run["dry_run"] is True
    assert {item["id"] for item in dry_run["candidates"]} == {"rejected", "draft", "rejected-later"}
    assert dry_run["reverted_ids"] == []
    assert db_session.get(SKCTKTModel, "rejected").completion_plan == "Đã hoàn thành 15/09/2026"

    applied = revert_auto_done(db_session, apply=True)
    assert set(applied["reverted_ids"]) == {"rejected", "draft", "rejected-later"}

    rejected = db_session.get(SKCTKTModel, "rejected")
    assert rejected.completion_plan == "Dự kiến hoàn thành 15/09/2026"
    assert rejected.completed_at is None
    assert rejected.revision == 3
    assert rejected.status == "Rejected"
    assert rejected.status_history[-1]["reason"] == "completion_auto_done_reverted"
    assert db_session.get(SKCTKTModel, "deferred").completed_at is not None
    assert db_session.get(SKCTKTModel, "confirmed").completed_at is not None
    assert db_session.get(SKCTKTModel, "edited").completion_plan == "Đã hoàn thành 01/09/2026"

    # Idempotent: the revert entry is now the latest progress change.
    assert revert_auto_done(db_session, apply=True)["candidates"] == []
