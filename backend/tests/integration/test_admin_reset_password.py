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
