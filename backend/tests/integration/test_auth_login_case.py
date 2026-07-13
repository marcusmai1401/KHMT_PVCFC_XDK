from app.core.config import settings


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


def test_login_accepts_accidental_copy_whitespace(client, admin_headers):
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "id": "trimuser",
            "display_name": "Trim User",
            "full_name": "Trim User",
            "password": "TrimPass123",
            "role": "Staff",
            "team": "TBCH",
        },
    )
    assert created.status_code == 200, created.text

    response = client.post(
        "/api/v1/auth/login",
        json={"user_id": "trimuser", "password": " TrimPass123 "},
    )

    assert response.status_code == 200, response.text


def test_login_still_accepts_passwords_with_real_outer_spaces(client, admin_headers):
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "id": "spacepass",
            "display_name": "Space Password",
            "full_name": "Space Password",
            "password": " SpacePass123 ",
            "role": "Staff",
            "team": "TBCH",
        },
    )
    assert created.status_code == 200, created.text

    ok = client.post(
        "/api/v1/auth/login",
        json={"user_id": "spacepass", "password": " SpacePass123 "},
    )
    stripped = client.post(
        "/api/v1/auth/login",
        json={"user_id": "spacepass", "password": "SpacePass123"},
    )

    assert ok.status_code == 200, ok.text
    assert stripped.status_code == 401


def test_sandbox_test_login_is_case_insensitive(client):
    response = client.post("/api/v1/auth/login", json={"user_id": "Test", "password": "PVCFC@123"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["role"] == "Admin"
    assert body["display_name"] == "Khách kiểm thử - Quản trị"


def test_direct_sandbox_test_login_is_disabled_in_production(client, monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")

    response = client.post("/api/v1/auth/login", json={"user_id": "Test", "password": "PVCFC@123"})

    assert response.status_code == 401, response.text
