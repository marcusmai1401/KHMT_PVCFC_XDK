"""Safely reset untouched accounts back to the default password.

The script only resets active non-admin users whose current password is not the
default, who have no recorded password change, and who either never logged in or
are still flagged as must_change_password.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.core.security import Role, hash_password, verify_password
from app.db.session import create_session
from app.models.domain import AuditLogModel, User
from app.services.repositories import audit


DEFAULT_PASSWORD = "PVCFC@123"
RESET_ACTION = "safe_default_password_reset"


@dataclass(frozen=True)
class PasswordResetCandidate:
    user_id: str
    display_name: str
    role: str
    team: str | None
    must_change_password: bool
    has_login: bool
    has_password_change: bool
    reasons: list[str]


@dataclass(frozen=True)
class PasswordResetReport:
    dry_run: bool
    reset_candidates: list[PasswordResetCandidate]
    admin_candidates: list[PasswordResetCandidate]
    reset_user_ids: list[str]
    skipped_counts: dict[str, int]

    def to_dict(self) -> dict:
        return {
            "dry_run": self.dry_run,
            "reset_candidates": [asdict(item) for item in self.reset_candidates],
            "admin_candidates": [asdict(item) for item in self.admin_candidates],
            "reset_user_ids": self.reset_user_ids,
            "skipped_counts": self.skipped_counts,
        }


def _account_action_user_ids(db: Session, action: str) -> set[str]:
    return set(
        db.scalars(
            select(AuditLogModel.entity_id).where(
                AuditLogModel.entity_type == "Account",
                AuditLogModel.action == action,
            )
        ).all()
    )


def _candidate_for_user(
    user: User,
    *,
    login_user_ids: set[str],
    password_change_user_ids: set[str],
) -> PasswordResetCandidate | None:
    if not user.is_active:
        return None
    if verify_password(DEFAULT_PASSWORD, user.password_hash):
        return None

    has_password_change = user.id in password_change_user_ids
    if has_password_change:
        return None

    has_login = user.id in login_user_ids
    must_change_password = bool(getattr(user, "must_change_password", False))
    if has_login and not must_change_password:
        return None

    reasons = ["password_not_default"]
    if not has_login:
        reasons.append("no_login_audit")
    if must_change_password:
        reasons.append("must_change_password")

    return PasswordResetCandidate(
        user_id=user.id,
        display_name=user.display_name,
        role=user.role,
        team=getattr(user, "team", None),
        must_change_password=must_change_password,
        has_login=has_login,
        has_password_change=has_password_change,
        reasons=reasons,
    )


def find_reset_candidates(
    db: Session,
) -> tuple[list[PasswordResetCandidate], list[PasswordResetCandidate], dict[str, int]]:
    login_user_ids = _account_action_user_ids(db, "login")
    password_change_user_ids = _account_action_user_ids(db, "change_password")
    users: Iterable[User] = db.scalars(select(User).order_by(User.id)).all()

    reset_candidates: list[PasswordResetCandidate] = []
    admin_candidates: list[PasswordResetCandidate] = []
    skipped_counts = {
        "inactive": 0,
        "already_default": 0,
        "has_password_change": 0,
        "logged_in_without_must_change": 0,
        "admin": 0,
    }

    for user in users:
        if not user.is_active:
            skipped_counts["inactive"] += 1
            continue
        if verify_password(DEFAULT_PASSWORD, user.password_hash):
            skipped_counts["already_default"] += 1
            continue
        if user.id in password_change_user_ids:
            skipped_counts["has_password_change"] += 1
            continue
        has_login = user.id in login_user_ids
        must_change_password = bool(getattr(user, "must_change_password", False))
        if has_login and not must_change_password:
            skipped_counts["logged_in_without_must_change"] += 1
            continue

        candidate = _candidate_for_user(
            user,
            login_user_ids=login_user_ids,
            password_change_user_ids=password_change_user_ids,
        )
        if candidate is None:
            continue
        if user.role == Role.ADMIN.value:
            admin_candidates.append(candidate)
            skipped_counts["admin"] += 1
            continue
        reset_candidates.append(candidate)

    return reset_candidates, admin_candidates, skipped_counts


def reset_default_password_candidates(*, apply: bool) -> PasswordResetReport:
    with create_session() as db:
        reset_candidates, admin_candidates, skipped_counts = find_reset_candidates(db)
        reset_user_ids: list[str] = []
        if apply:
            candidate_by_id = {candidate.user_id: candidate for candidate in reset_candidates}
            for user_id, candidate in candidate_by_id.items():
                user = db.get(User, user_id)
                if user is None or not user.is_active:
                    continue
                user.password_hash = hash_password(DEFAULT_PASSWORD)
                user.must_change_password = True
                reset_user_ids.append(user.id)
                audit(
                    db,
                    "system",
                    "Account",
                    user.id,
                    RESET_ACTION,
                    {
                        "reasons": candidate.reasons,
                        "has_login": candidate.has_login,
                        "must_change_password": candidate.must_change_password,
                    },
                )
            db.commit()
        return PasswordResetReport(
            dry_run=not apply,
            reset_candidates=reset_candidates,
            admin_candidates=admin_candidates,
            reset_user_ids=reset_user_ids,
            skipped_counts=skipped_counts,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply resets. Without this flag the script only reports candidates.",
    )
    args = parser.parse_args()

    report = reset_default_password_candidates(apply=args.apply)
    print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
