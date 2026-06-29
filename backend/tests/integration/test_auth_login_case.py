def test_login_falls_back_to_lowercase_user_id(client, admin_headers):
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "id": "caseuser",
            "display_name": "Case User",
            "full_name": "Case User",
            "password": "CasePass123",
            "role": "Staff",
            "team": "TBCH",
            "must_change_password": True,
        },
    )
    assert created.status_code == 200, created.text

    response = client.post(
        "/api/v1/auth/login",
        json={"user_id": "Caseuser", "password": "CasePass123"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display_name"] == "Case User"
    assert body["must_change_password"] is True


def test_sandbox_test_login_is_case_insensitive(client):
    response = client.post("/api/v1/auth/login", json={"user_id": "Test", "password": "PVCFC@123"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["role"] == "Admin"
    assert body["display_name"] == "Khách kiểm thử - Quản trị"
