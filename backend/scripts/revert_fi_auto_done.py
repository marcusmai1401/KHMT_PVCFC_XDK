"""Undo "Đã hoàn thành" that the completion schedule set on Draft/Rejected FI.

Before the schedule learned to skip drafts and rejected SK, it ticked them done
when their planned date arrived. This script restores the plan recorded in that
``completion_auto_done`` history entry. It only touches an SK when the automatic
tick is still its latest progress change and the plan has not been edited since,
so anything an author or Admin set by hand is left alone.

Dry run by default; pass --apply to write.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.db.session import create_session
from app.models.domain import SKCTKTModel
from app.services.cache import cache_delete_prefix
from app.services.fi.auto_completion import (
    AUTO_DONE_REASON,
    AUTO_PLANNED_REASON,
    NOT_AUTO_DONE_STATUSES,
    SYSTEM_ACTOR,
)
from app.services.repositories import audit

REVERT_REASON = "completion_auto_done_reverted"
# Mọi lần đổi tiến độ đều ghi một trong các reason này vào status_history.
PLAN_HISTORY_REASONS = {AUTO_DONE_REASON, AUTO_PLANNED_REASON, "completion_plan_update", REVERT_REASON}


@dataclass(frozen=True)
class RevertCandidate:
    id: str
    sk_code: str
    status: str
    completion_plan: str
    restored_plan: str
    restored_completed_at: str | None


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _candidate(record: SKCTKTModel) -> RevertCandidate | None:
    if record.status not in NOT_AUTO_DONE_STATUSES:
        return None
    history = record.status_history if isinstance(record.status_history, list) else []
    last_plan_entry = next(
        (entry for entry in reversed(history) if isinstance(entry, dict) and entry.get("reason") in PLAN_HISTORY_REASONS),
        None,
    )
    if last_plan_entry is None or last_plan_entry.get("reason") != AUTO_DONE_REASON:
        return None
    comments = last_plan_entry.get("comments") if isinstance(last_plan_entry.get("comments"), dict) else {}
    previous_plan = comments.get("previous_completion_plan")
    if previous_plan is None or record.completion_plan != comments.get("completion_plan"):
        return None
    return RevertCandidate(
        id=record.id,
        sk_code=record.sk_code,
        status=record.status,
        completion_plan=record.completion_plan,
        restored_plan=previous_plan,
        restored_completed_at=comments.get("previous_completed_at"),
    )


def find_revert_candidates(db: Session) -> list[RevertCandidate]:
    records = db.scalars(
        select(SKCTKTModel).where(SKCTKTModel.status.in_(NOT_AUTO_DONE_STATUSES)).order_by(SKCTKTModel.sk_code)
    ).all()
    return [candidate for record in records if (candidate := _candidate(record)) is not None]


def revert_auto_done(db: Session, *, apply: bool) -> dict[str, Any]:
    candidates = find_revert_candidates(db)
    reverted: list[str] = []
    if apply:
        now = datetime.now(timezone.utc)
        for candidate in candidates:
            record = db.scalars(
                select(SKCTKTModel).where(SKCTKTModel.id == candidate.id).with_for_update()
            ).first()
            # Re-check under the lock in case the SK changed since it was listed.
            if record is None or _candidate(record) != candidate:
                continue
            restored_completed_at = _parse_datetime(candidate.restored_completed_at)
            record.completion_plan = candidate.restored_plan
            record.completed_at = restored_completed_at
            record.revision += 1
            record.status_history = [
                *record.status_history,
                {
                    "from_status": record.status,
                    "to_status": record.status,
                    "changed_by": SYSTEM_ACTOR,
                    "changed_at": now.isoformat(),
                    "reason": REVERT_REASON,
                    "comments": {
                        "previous_completion_plan": candidate.completion_plan,
                        "completion_plan": candidate.restored_plan,
                        "completed_at": candidate.restored_completed_at,
                    },
                },
            ]
            audit(
                db,
                SYSTEM_ACTOR,
                "SK_CTKT",
                record.id,
                REVERT_REASON,
                {"previous_completion_plan": candidate.completion_plan, "completion_plan": candidate.restored_plan},
            )
            reverted.append(record.id)
        db.commit()
        if reverted:
            cache_delete_prefix("fi:public_sk")
            cache_delete_prefix("okr:dashboard")
    return {
        "dry_run": not apply,
        "candidates": [asdict(candidate) for candidate in candidates],
        "reverted_ids": reverted,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes. Without this flag the script only lists what it would revert.",
    )
    args = parser.parse_args()
    with create_session() as db:
        report = revert_auto_done(db, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
