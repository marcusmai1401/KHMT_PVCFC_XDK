from app.core.security import hash_password, verify_password
from app.models.domain import User
from app.services.bootstrap import seed_baseline


def test_bcrypt_hash_and_verify_round_trip():
    password_hash = hash_password("StrongPassword123")

    assert password_hash.startswith(("$2a$", "$2b$", "$2y$"))
    assert verify_password("StrongPassword123", password_hash) is True
    assert verify_password("wrong", password_hash) is False


def test_invalid_password_hash_returns_false():
    assert verify_password("pw", "not-a-bcrypt-hash") is False


def test_development_seed_preserves_existing_demo_password(db_session):
    user = db_session.get(User, "TBCH")
    assert user is not None
    user.password_hash = hash_password("Custom1234")
    user.must_change_password = False
    db_session.commit()

    seed_baseline(db_session)
    db_session.refresh(user)

    assert verify_password("Custom1234", user.password_hash) is True
    assert verify_password("tbch-pass", user.password_hash) is False
