"""Rename FI SK codes from `-Workshop_Staff-` to `-XQL-`.

User accounts and FI records keep `team = "Workshop_Staff"` so role checks,
employee team assignments, and headcount exclusions remain unchanged. Only the
human-facing `sk_code`, `sk_code_sequences.prefix`, and cached `sk_code` inside
notifications are shortened from `-Workshop_Staff-` to `-XQL-`.

Dry run by default; pass `--apply` to write changes.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
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
from app.models.domain import NotificationModel, SKCTKTModel, SKCodeSequenceModel
from app.services.cache import cache_delete_prefix
from app.services.repositories import audit

OLD_SEGMENT = "-Workshop_Staff-"
NEW_SEGMENT = "-XQL-"
OLD_PREFIX_SUFFIX = "-Workshop_Staff"
NEW_PREFIX_SUFFIX = "-XQL"
AUDIT_ACTION = "rename_sk_code_workshop_staff_to_xql"


@dataclass(frozen=True)
class RenameCandidate:
    id: str
    old_code: str
    new_code: str
    conflict: bool = False


def _target_sk_code(code: str | None) -> str | None:
    if not code or OLD_SEGMENT not in code:
        return None
    return code.replace(OLD_SEGMENT, NEW_SEGMENT, 1)


def find_rename_candidates(db: Session) -> list[RenameCandidate]:
    records = db.scalars(
        select(SKCTKTModel)
        .where(SKCTKTModel.sk_code.like(f"%{OLD_SEGMENT}%"))
        .order_by(SKCTKTModel.sk_code)
    ).all()
    if not records:
        return []
    existing_codes = set(db.scalars(select(SKCTKTModel.sk_code)).all())
    candidates: list[RenameCandidate] = []
    for record in records:
        new_code = _target_sk_code(record.sk_code)
        if not new_code:
            continue
        candidates.append(
            RenameCandidate(
                id=record.id,
                old_code=record.sk_code,
                new_code=new_code,
                conflict=new_code in existing_codes,
            )
        )
    return candidates


def rename_workshop_staff_sk_codes(db: Session, *, apply: bool) -> dict[str, Any]:
    candidates = find_rename_candidates(db)
    renamed_ids: list[str] = []
    skipped_conflicts: list[dict[str, str]] = []
    updated_sequences = 0
    updated_notifications = 0

    if apply:
        code_map: dict[str, str] = {}
        id_to_new_code: dict[str, str] = {}
        for candidate in candidates:
            if candidate.conflict:
                skipped_conflicts.append(
                    {"id": candidate.id, "old_code": candidate.old_code, "new_code": candidate.new_code}
                )
                continue
            record = db.scalars(
                select(SKCTKTModel).where(SKCTKTModel.id == candidate.id).with_for_update()
            ).first()
            if record is None or record.sk_code != candidate.old_code:
                continue
            existing = db.scalars(
                select(SKCTKTModel).where(SKCTKTModel.sk_code == candidate.new_code)
            ).first()
            if existing is not None:
                skipped_conflicts.append(
                    {"id": candidate.id, "old_code": candidate.old_code, "new_code": candidate.new_code}
                )
                continue
            record.sk_code = candidate.new_code
            record.revision += 1
            audit(
                db,
                "system",
                "SK_CTKT",
                record.id,
                AUDIT_ACTION,
                {"old_code": candidate.old_code, "new_code": candidate.new_code},
            )
            code_map[candidate.old_code] = candidate.new_code
            id_to_new_code[record.id] = candidate.new_code
            renamed_ids.append(record.id)

        sequences = db.scalars(
            select(SKCodeSequenceModel).where(SKCodeSequenceModel.prefix.like(f"%{OLD_PREFIX_SUFFIX}"))
        ).all()
        for seq in sequences:
            if not seq.prefix.endswith(OLD_PREFIX_SUFFIX):
                continue
            target_prefix = f"{seq.prefix[: -len(OLD_PREFIX_SUFFIX)]}{NEW_PREFIX_SUFFIX}"
            target_seq = db.get(SKCodeSequenceModel, target_prefix)
            if target_seq is not None:
                target_seq.next_value = max(int(target_seq.next_value), int(seq.next_value))
                db.delete(seq)
            else:
                db.add(SKCodeSequenceModel(prefix=target_prefix, next_value=int(seq.next_value)))
                db.delete(seq)
            updated_sequences += 1

        if code_map or id_to_new_code:
            notifications = db.scalars(
                select(NotificationModel).where(NotificationModel.event.like("SK_%"))
            ).all()
            for notif in notifications:
                payload = notif.payload if isinstance(notif.payload, dict) else None
                if not payload:
                    continue
                next_code = id_to_new_code.get(str(payload.get("id") or "")) or code_map.get(
                    str(payload.get("sk_code") or "")
                )
                if next_code and payload.get("sk_code") != next_code:
                    notif.payload = {**payload, "sk_code": next_code}
                    updated_notifications += 1

        db.commit()
        if renamed_ids:
            cache_delete_prefix("fi:public_sk")
            cache_delete_prefix("okr:dashboard")

    return {
        "dry_run": not apply,
        "candidates": [asdict(candidate) for candidate in candidates],
        "renamed_ids": renamed_ids,
        "skipped_conflicts": skipped_conflicts,
        "updated_sequences": updated_sequences,
        "updated_notifications": updated_notifications,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the updated SK codes. Without this flag, prints candidates only.",
    )
    args = parser.parse_args()
    with create_session() as db:
        report = rename_workshop_staff_sk_codes(db, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
