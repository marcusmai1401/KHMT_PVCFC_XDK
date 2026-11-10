from app.core.login_limiter import PAIR_LIMIT
from app.core.security import DEFAULT_RESET_PASSWORD


def _create_user(client, admin_headers, user_id: str, password: str = "RealPass123") -> None:
    response = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "id": user_id,
            "display_name": f"Diag {user_id}",
            "full_name": f"Diag {user_id}",
            "password": password,
            "role": "Staff",
            "team": "TBCH",
        },
    )
    assert response.status_code == 200, response.text


def _failed_logins(client, admin_headers, entity_id: str) -> list[dict]:
    response = client.get("/api/v1/admin/audit-log", headers=admin_headers, params={"entity_type": "Account"})
    assert response.status_code == 200, response.text
    return [row for row in response.json() if row["action"] == "login_failed" and row["entity_id"] == entity_id]


def test_wrong_password_leaves_a_reason_without_the_password(client, admin_headers):
    _create_user(client, admin_headers, "diagwrong")

    response = client.post("/api/v1/auth/login", json={"user_id": "diagwrong", "password": "pasưord123"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Sai tài khoản hoặc mật khẩu"
    rows = _failed_logins(client, admin_headers, "diagwrong")
    assert len(rows) == 1
    assert rows[0]["actor"] == "diagwrong"
    assert rows[0]["changes"] == {
        "reason": "wrong_password",
        "typed_default_password": False,
        "non_ascii_password": True,
        "outer_whitespace": False,
    }


def test_default_password_against_an_account_that_was_not_reset_is_flagged(client, admin_headers):
    # The reset was applied to a different account: the person types the
    # default password they were told about and it is rejected.
    _create_user(client, admin_headers, "diagnotreset")

    response = client.post("/api/v1/auth/login", json={"user_id": "diagnotreset", "password": DEFAULT_RESET_PASSWORD})

    assert response.status_code == 401
    rows = _failed_logins(client, admin_headers, "diagnotreset")
    assert rows[0]["changes"]["reason"] == "wrong_password"
    assert rows[0]["changes"]["typed_default_password"] is True


def test_unknown_account_is_recorded_under_the_typed_identifier(client, admin_headers):
    response = client.post("/api/v1/auth/login", json={"user_id": "diagghost@pvcfc.com.vn", "password": "Whatever123"})

    assert response.status_code == 401
    rows = _failed_logins(client, admin_headers, "diagghost@pvcfc.com.vn")
    assert rows[0]["actor"] == "anonymous"
    assert rows[0]["changes"]["reason"] == "unknown_account"


def test_admin_reset_lifts_the_lockout_so_the_temporary_password_works(client, admin_headers):
    _create_user(client, admin_headers, "diaglocked")
    for _ in range(PAIR_LIMIT):
        assert client.post("/api/v1/auth/login", json={"user_id": "diaglocked", "password": "Forgotten123"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"user_id": "diaglocked", "password": "RealPass123"}).status_code == 429

    reset = client.post("/api/v1/admin/users/diaglocked/reset-password", headers=admin_headers, json={})
    assert reset.status_code == 200, reset.text

    response = client.post("/api/v1/auth/login", json={"user_id": "diaglocked", "password": DEFAULT_RESET_PASSWORD})
    assert response.status_code == 200, response.text
    assert response.json()["must_change_password"] is True


def test_successful_login_forgets_earlier_typos(client, admin_headers):
    _create_user(client, admin_headers, "diagtypo")
    for _ in range(PAIR_LIMIT - 1):
        assert client.post("/api/v1/auth/login", json={"user_id": "diagtypo", "password": "Typo12345"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"user_id": "diagtypo", "password": "RealPass123"}).status_code == 200

    # One more typo after a good sign-in must not lock the account out.
    assert client.post("/api/v1/auth/login", json={"user_id": "diagtypo", "password": "Typo12345"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"user_id": "diagtypo", "password": "RealPass123"}).status_code == 200


def test_change_password_rejects_input_method_rewritten_passwords(client, admin_headers):
    _create_user(client, admin_headers, "diagime")
    token = client.post("/api/v1/auth/login", json={"user_id": "diagime", "password": "RealPass123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    accented = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"old_password": "RealPass123", "new_password": "pasưord123"},
    )
    padded = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"old_password": "RealPass123", "new_password": "NewPass1234 "},
    )
    accepted = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"old_password": "RealPass123", "new_password": "NewPass@1234"},
    )

    assert accented.status_code == 400 and "Unikey" in accented.json()["detail"]
    assert padded.status_code == 400
    assert accepted.status_code == 200, accepted.text
