from app.core.security import hash_password, verify_password
from app.models.domain import AuditLogModel, User
from scripts.reset_default_password_candidates import (
    DEFAULT_PASSWORD,
    RESET_ACTION,
    find_reset_candidates,
    reset_default_password_candidates,
)


def _add_user(
    db_session,
    user_id: str,
    *,
    password: str,
    role: str = "Staff",
    must_change: bool = False,
    active: bool = True,
):
    user = User(
        id=user_id,
        display_name=user_id,
        full_name=user_id,
        password_hash=hash_password(password),
        role=role,
        team="TBCH",
        must_change_password=must_change,
        is_active=active,
    )
    db_session.add(user)
    return user


def _add_account_audit(db_session, user_id: str, action: str):
    db_session.add(
        AuditLogModel(
            id=f"audit-{user_id}-{action}",
            actor=user_id,
            entity_type="Account",
            entity_id=user_id,
            action=action,
            changes={},
        )
    )


def test_find_reset_candidates_skips_admin_and_private_passwords(db_session):
    _add_user(db_session, "untouched", password="Private123")
    _add_user(db_session, "pending", password="Private123", must_change=True)
    _add_user(db_session, "changed", password="Private123")
    _add_user(db_session, "logged", password="Private123")
    _add_user(db_session, "inactive", password="Private123", active=False)
    _add_user(db_session, "defaulted", password=DEFAULT_PASSWORD)
    _add_user(db_session, "admin-candidate", password="Private123", role="Admin", must_change=True)
    _add_account_audit(db_session, "pending", "login")
    _add_account_audit(db_session, "changed", "change_password")
    _add_account_audit(db_session, "logged", "login")
    db_session.commit()

    reset_candidates, admin_candidates, skipped_counts = find_reset_candidates(db_session)

    reset_ids = {candidate.user_id for candidate in reset_candidates}
    admin_ids = {candidate.user_id for candidate in admin_candidates}
    assert {"untouched", "pending"}.issubset(reset_ids)
    assert "admin-candidate" in admin_ids
    assert "changed" not in reset_ids
    assert "logged" not in reset_ids
    assert "inactive" not in reset_ids
    assert "defaulted" not in reset_ids
    assert skipped_counts["admin"] >= 1


def test_apply_resets_only_safe_non_admin_candidates(db_session):
    untouched = _add_user(db_session, "apply-untouched", password="Private123")
    changed = _add_user(db_session, "apply-changed", password="Private123")
    admin = _add_user(
        db_session,
        "apply-admin",
        password="Private123",
        role="Admin",
        must_change=True,
    )
    _add_account_audit(db_session, "apply-changed", "change_password")
    db_session.commit()

    report = reset_default_password_candidates(apply=True)
    db_session.expire_all()

    db_session.refresh(untouched)
    db_session.refresh(changed)
    db_session.refresh(admin)
    assert "apply-untouched" in report.reset_user_ids
    assert verify_password(DEFAULT_PASSWORD, untouched.password_hash) is True
    assert untouched.must_change_password is True
    assert verify_password(DEFAULT_PASSWORD, changed.password_hash) is False
    assert verify_password(DEFAULT_PASSWORD, admin.password_hash) is False

    audit_actions = {
        row.action
        for row in db_session.query(AuditLogModel)
        .filter(AuditLogModel.entity_id == "apply-untouched")
        .all()
    }
    assert RESET_ACTION in audit_actions
