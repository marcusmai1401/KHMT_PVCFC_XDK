from app.core.config import settings


def _login(client, user_id, password):
    return client.post("/api/v1/auth/login", json={"user_id": user_id, "password": password})


def test_admin_reset_password_default_forces_change(client, admin_headers):
    # 'leader' la demo user (password 'leader-pass'); sau reset phai dung mat khau mac dinh.
    resp = client.post("/api/v1/admin/users/leader/reset-password", json={}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["temporary_password"] == "PVCFC@123"
    assert body["must_change_password"] is True
    assert body["password_hash"] is None

    # Mat khau cu khong con dung
    assert _login(client, "leader", "leader-pass").status_code == 401
    # Mat khau tam dung duoc va bi buoc doi
    ok = _login(client, "leader", "PVCFC@123")
    assert ok.status_code == 200
    assert ok.json()["must_change_password"] is True


def test_admin_reset_password_custom_value(client, admin_headers):
    resp = client.post(
        "/api/v1/admin/users/fi/reset-password",
        json={"new_password": "TempPass99"},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["temporary_password"] == "TempPass99"
    assert _login(client, "fi", "TempPass99").status_code == 200


def test_admin_reset_password_rejects_weak_custom(client, admin_headers):
    resp = client.post(
        "/api/v1/admin/users/fi/reset-password",
        json={"new_password": "short"},
        headers=admin_headers,
    )
    assert resp.status_code == 400


def test_admin_reset_password_unknown_user(client, admin_headers):
    resp = client.post("/api/v1/admin/users/nope/reset-password", json={}, headers=admin_headers)
    assert resp.status_code == 404


def test_admin_reset_password_requires_admin(client):
    login = _login(client, "leader", "leader-pass")
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = client.post("/api/v1/admin/users/fi/reset-password", json={}, headers=headers)
    assert resp.status_code == 403


def test_admin_reset_password_writes_audit(client, admin_headers):
    client.post("/api/v1/admin/users/leader/reset-password", json={}, headers=admin_headers)
    logs = client.get("/api/v1/admin/audit-log", headers=admin_headers).json()
    actions = [row["action"] for row in logs if row.get("entity_id") == "leader"]
    assert "admin_reset_password" in actions


def test_admin_can_reset_sandbox_test_login(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")

    default_login = _login(client, "test", "PVCFC@123")
    assert default_login.status_code == 401

    sandbox_users = client.get("/api/v1/admin/sandbox-users", headers=admin_headers)
    assert sandbox_users.status_code == 200, sandbox_users.text
    test_row = next(row for row in sandbox_users.json() if row["id"] == "test")
    assert test_row["account_scope"] == "sandbox"
    assert test_row["role"] == "Admin"
    assert test_row["direct_login_enabled"] is False

    reset = client.post(
        "/api/v1/admin/sandbox-users/test/reset-password",
        headers=admin_headers,
        json={},
    )
    assert reset.status_code == 200, reset.text
    temporary_password = reset.json()["temporary_password"]
    assert temporary_password != "PVCFC@123"
    assert reset.json()["direct_login_enabled"] is True

    login = _login(client, "test", temporary_password)
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "Admin"
    me = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert me.status_code == 200, me.text
    assert me.json()["sandbox"] is True
    assert me.json()["user_id"] == "test"
