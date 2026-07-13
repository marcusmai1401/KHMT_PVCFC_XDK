def _create_pending_user(client, admin_headers, *, user_id: str = "pending-user") -> None:
    response = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "id": user_id,
            "display_name": "Pending User",
            "full_name": "Pending User",
            "password": "Temporary123",
            "role": "Staff",
            "team": "TBCH",
            "must_change_password": True,
        },
    )
    assert response.status_code == 200, response.text


def _login(client, *, user_id: str = "pending-user", password: str = "Temporary123"):
    response = client.post(
        "/api/v1/auth/login",
        json={"user_id": user_id, "password": password},
    )
    assert response.status_code == 200, response.text
    return response


def test_pending_account_can_only_inspect_session_and_change_password(client, admin_headers):
    _create_pending_user(client, admin_headers)
    login = _login(client)
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    assert login.json()["must_change_password"] is True

    profile = client.get("/api/v1/auth/me", headers=headers)
    assert profile.status_code == 200, profile.text
    assert profile.json()["must_change_password"] is True

    blocked = client.get("/api/v1/notifications", headers=headers)
    assert blocked.status_code == 403, blocked.text
    assert "đổi mật khẩu" in blocked.json()["detail"]

    # Logging in again does not clear the database flag or unlock business APIs.
    second_login = _login(client)
    assert second_login.json()["must_change_password"] is True
    second_headers = {"Authorization": f"Bearer {second_login.json()['access_token']}"}
    assert client.get("/api/v1/notifications", headers=second_headers).status_code == 403

    changed = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"old_password": "Temporary123", "new_password": "NewPassword456"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["must_change_password"] is False

    # Authorization reads the current database state, so the account unlocks
    # immediately after the successful change, even with the original token.
    unlocked = client.get("/api/v1/notifications", headers=headers)
    assert unlocked.status_code == 200, unlocked.text


def test_whitespace_old_password_cannot_clear_flag_with_same_effective_password(client, admin_headers):
    _create_pending_user(client, admin_headers, user_id="pending-whitespace")
    login = _login(client, user_id="pending-whitespace")
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={"old_password": " Temporary123 ", "new_password": "Temporary123"},
    )

    assert response.status_code == 400, response.text
    assert client.get("/api/v1/auth/me", headers=headers).json()["must_change_password"] is True
    assert client.get("/api/v1/notifications", headers=headers).status_code == 403
