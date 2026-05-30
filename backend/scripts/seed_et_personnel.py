"""Seed ET personnel records from a versioned snapshot.

Run from the backend folder:

    python scripts/seed_et_personnel.py

The seed is idempotent and non-destructive: it creates or updates snapshot
rows by user_id, employee_code, or id, and does not delete other personnel.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.db.session import create_session
from app.models.domain import User
from app.models.et_domain import Personnel, PersonnelHiddenRow
from app.services.bootstrap import create_schema
from app.services.repositories import audit, make_id


SEED_PATH = _BACKEND_DIR / "app" / "data" / "et_personnel_seed.json"
PERSONNEL_FIELDS = (
    "employee_code",
    "full_name",
    "role",
    "position_code",
    "team",
    "current_level",
    "salary_grade",
    "hire_date",
    "status",
    "user_id",
)


def _load_seed(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _find_existing(db, item: dict[str, Any]) -> Personnel | None:
    user_id = item.get("user_id")
    if user_id:
        row = db.execute(select(Personnel).where(Personnel.user_id == user_id)).scalar_one_or_none()
        if row is not None:
            return row

    employee_code = item.get("employee_code")
    if employee_code:
        row = db.execute(select(Personnel).where(Personnel.employee_code == employee_code)).scalar_one_or_none()
        if row is not None:
            return row

    row_id = item.get("id")
    if row_id:
        return db.get(Personnel, row_id)
    return None


def _validated_payload(db, item: dict[str, Any]) -> dict[str, Any]:
    payload = {field: item.get(field) for field in PERSONNEL_FIELDS if field in item}
    if not payload.get("full_name"):
        raise ValueError("Personnel seed row is missing full_name")
    if not payload.get("status"):
        payload["status"] = "active"

    user_id = payload.get("user_id")
    if user_id and db.get(User, user_id) is None:
        payload["user_id"] = None
    return payload


def _unhide_linked_user(db, user_id: str | None) -> None:
    if not user_id:
        return
    hidden = db.execute(
        select(PersonnelHiddenRow).where(
            PersonnelHiddenRow.source_type == "user",
            PersonnelHiddenRow.source_id == user_id,
        )
    ).scalar_one_or_none()
    if hidden is not None:
        db.delete(hidden)


def seed_personnel(actor: str = "admin", seed_path: Path = SEED_PATH) -> dict[str, int]:
    create_schema()
    data = _load_seed(seed_path)
    counts = {"created": 0, "updated": 0, "skipped": 0}
    with create_session() as db:
        audit_actor = actor if db.get(User, actor) is not None else (db.scalar(select(User.id).order_by(User.id)) or "system")
        for item in data.get("personnel") or []:
            payload = _validated_payload(db, item)
            existing = _find_existing(db, item)
            if existing is None:
                row = Personnel(id=item.get("id") or make_id("etperson"), **payload)
                db.add(row)
                db.flush()
                _unhide_linked_user(db, row.user_id)
                audit(db, audit_actor, "Personnel", row.id, "seed_et_personnel", {"source": data.get("source")})
                counts["created"] += 1
                continue

            before = {
                field: getattr(existing, field)
                for field in PERSONNEL_FIELDS
                if hasattr(existing, field)
            }
            for field, value in payload.items():
                setattr(existing, field, value)
            _unhide_linked_user(db, existing.user_id)
            after = {
                field: getattr(existing, field)
                for field in PERSONNEL_FIELDS
                if hasattr(existing, field)
            }
            if before != after:
                audit(
                    db,
                    audit_actor,
                    "Personnel",
                    existing.id,
                    "seed_et_personnel_update",
                    {"before": before, "after": after, "source": data.get("source")},
                )
                counts["updated"] += 1
            else:
                counts["skipped"] += 1
        db.commit()
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor", default="admin", help="User id recorded in audit logs")
    parser.add_argument("--seed-path", type=Path, default=SEED_PATH)
    args = parser.parse_args()

    result = seed_personnel(actor=args.actor, seed_path=args.seed_path)
    print(
        f"ET personnel seed complete: created={result['created']}, "
        f"updated={result['updated']}, skipped={result['skipped']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
