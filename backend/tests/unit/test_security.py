from app.core.security import hash_password, verify_password


def test_bcrypt_hash_and_verify_round_trip():
    password_hash = hash_password("StrongPassword123")

    assert password_hash.startswith(("$2a$", "$2b$", "$2y$"))
    assert verify_password("StrongPassword123", password_hash) is True
    assert verify_password("wrong", password_hash) is False


def test_invalid_password_hash_returns_false():
    assert verify_password("pw", "not-a-bcrypt-hash") is False
