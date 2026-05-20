def test_health_admin_auth_and_mapping(client, admin_headers):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/api/v1/admin/kr-mapping").status_code == 401
    response = client.get("/api/v1/admin/kr-mapping", headers=admin_headers)
    assert response.status_code == 200
    assert len(response.json()) == 37
