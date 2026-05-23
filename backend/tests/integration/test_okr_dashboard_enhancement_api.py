from io import BytesIO

from openpyxl import Workbook


def _login(client, user_id: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"user_id": user_id, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _snapshot_file() -> BytesIO:
    workbook = Workbook()
    dashboard = workbook.active
    dashboard.title = "Dashboard"
    dashboard["A20"] = "LŨY KẾ NĂM 2026"
    dashboard["A22"] = "Tổ trực ca"
    dashboard["F22"] = "HT tốt"
    workbook.create_sheet("data")
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def test_dashboard_payload_shape_and_team_scope(client, admin_headers):
    admin_dashboard = client.get("/api/v1/okr/dashboard/4/2026", headers=admin_headers)
    assert admin_dashboard.status_code == 200
    payload = admin_dashboard.json()
    assert "columns" in payload and "teams" in payload
    assert "monthly_history" in payload and "chart_blocks" in payload
    assert "minor_okr_summary" in payload
    assert payload["period"]["label"] == "T4/2026"
    assert [section["objective_code"] for section in payload["objective_sections"]] == ["O1", "O2", "O3", "O4", "O5", "O6"]
    assert "technical_metadata" in payload
    assert payload["source_references"]["unconfirmed_blocks"][0]["mapping_status"] == "needs_confirmation"

    team_headers = _login(client, "TBCH", "tbch-pass")
    team_dashboard = client.get("/api/v1/okr/dashboard/4/2026", headers=team_headers)
    assert team_dashboard.status_code == 200
    team_payload = team_dashboard.json()
    assert [row["team"] for row in team_payload["teams"]] == ["TBHTĐK", "TBCH", "TBĐL", "TCĐK"]
    assert [row["team"] for row in team_payload["monthly_history"]] == ["TBHTĐK", "TBCH", "TBĐL", "TCĐK"]


def test_dashboard_latest_endpoint_returns_resolved_period(client, admin_headers):
    response = client.get("/api/v1/okr/dashboard/latest", headers=admin_headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["period"]["source"] in {"latest_data", "workbook", "current"}
    assert payload["period"]["label"] == f"T{payload['period']['month']}/{payload['period']['year']}"
    assert "objective_sections" in payload


def test_historical_snapshot_import_endpoint_permissions(client, admin_headers):
    response = client.post(
        "/api/v1/okr/historical-snapshots/import",
        headers=admin_headers,
        files={"file": ("snapshot.xlsx", _snapshot_file(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["imported_count"] > 0
    assert response.json()["months_covered"] == [1]

    leader_headers = _login(client, "leader", "leader-pass")
    forbidden = client.post(
        "/api/v1/okr/historical-snapshots/import",
        headers=leader_headers,
        files={"file": ("snapshot.xlsx", _snapshot_file(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert forbidden.status_code == 403
