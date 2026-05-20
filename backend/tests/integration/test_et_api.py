from pathlib import Path
from io import BytesIO

from openpyxl import load_workbook


def _login(client, user_id: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"user_id": user_id, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _import_frameworks(client, headers):
    workbook = Path(__file__).resolve().parents[3] / "Khung năng lực chuyên môn_X.ĐK_Rev14.xlsx"
    with workbook.open("rb") as file:
        response = client.post(
            "/api/v1/et/frameworks/import",
            headers=headers,
            files={"file": ("knl.xlsx", file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
    assert response.status_code == 200, response.text
    assert len(response.json()["created"]) == 5
    return response.json()["created"]


def test_framework_import_and_assessment_dashboard_flow(client, admin_headers):
    frameworks = _import_frameworks(client, admin_headers)
    framework_export = client.get(f"/api/v1/et/frameworks/{frameworks[0]['id']}/export", headers=admin_headers)
    assert framework_export.status_code == 200
    framework_workbook = load_workbook(BytesIO(framework_export.content), data_only=False)
    framework_sheet = framework_workbook.active
    assert framework_sheet["A1"].value == "KHUNG NĂNG LỰC CHUYÊN MÔN"
    assert framework_sheet["A2"].value == frameworks[0]["title"]
    assert framework_sheet["A3"].value == "Phân nhóm"
    assert framework_sheet["F4"].value.startswith("=SUM(F6:F")
    assert framework_sheet["F5"].value == 1
    assert framework_sheet["D6"].value == "ĐK_NLCM_001"
    personnel_response = client.post(
        "/api/v1/et/personnel",
        headers=admin_headers,
        json={
            "employee_code": "ET001",
            "full_name": "Nguyễn Văn ET",
            "position_code": "KNL_ĐK_14",
            "team": "TBHTĐK",
            "current_level": 2,
            "status": "active",
            "user_id": "TBHTĐK",
        },
    )
    assert personnel_response.status_code == 200, personnel_response.text
    personnel_id = personnel_response.json()["id"]

    assessment_response = client.post(
        "/api/v1/et/assessments",
        headers=admin_headers,
        json={"personnel_id": personnel_id, "assessment_period": "2026-Q2"},
    )
    assert assessment_response.status_code == 200, assessment_response.text
    assessment = assessment_response.json()
    assert assessment["status"] == "draft"
    assert assessment["personnel_level_at_assessment"] == 2
    assert assessment["items"]
    assert all(item["gap"] is None for item in assessment["items"])

    update_response = client.put(
        f"/api/v1/et/assessments/{assessment['id']}",
        headers=admin_headers,
        json={
            "items": [
                {"id": item["id"], "actual_score": item["required_score"]}
                for item in assessment["items"]
                if item["required_score"] <= 5
            ],
            "notes": "Đạt yêu cầu",
        },
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["overall_result"] == "Đạt"

    submit_response = client.post(f"/api/v1/et/assessments/{assessment['id']}/submit", headers=admin_headers)
    assert submit_response.status_code == 200, submit_response.text
    submitted = submit_response.json()
    assert submitted["status"] == "submitted"
    assert submitted["is_latest"] is True

    dashboard_response = client.get("/api/v1/et/dashboard", headers=admin_headers)
    assert dashboard_response.status_code == 200
    dashboard = dashboard_response.json()
    assert dashboard["aggregate"]["total_active_personnel"] == 1
    assert dashboard["aggregate"]["pass_count"] == 1
    assert dashboard["rows"][0]["achieved_count"] > 0

    heatmap_response = client.get("/api/v1/et/dashboard/heatmap", headers=admin_headers)
    assert heatmap_response.status_code == 200
    assert heatmap_response.json()["rows"]

    export_response = client.get(f"/api/v1/et/assessments/{assessment['id']}/export", headers=admin_headers)
    assert export_response.status_code == 200
    assert export_response.content.startswith(b"PK")

    plan_response = client.post(
        "/api/v1/et/learning-plans",
        headers=admin_headers,
        json={
            "personnel_id": personnel_id,
            "title": "Kế hoạch test",
            "start_date": "2026-04-15",
            "duration_months": 2,
            "items": [{"item_id": assessment["items"][0]["item_id"], "target_week": 1, "target_level": 2}],
        },
    )
    assert plan_response.status_code == 200, plan_response.text
    plan_export = client.get(f"/api/v1/et/learning-plans/{plan_response.json()['id']}/export", headers=admin_headers)
    assert plan_export.status_code == 200
    plan_workbook = load_workbook(BytesIO(plan_export.content), data_only=True)
    plan_sheet = plan_workbook["Project Timeline"]
    assert plan_sheet["B1"].value == "KẾ HOẠCH HỌC TẬP NHÂN SỰ MỚI"
    assert plan_sheet["E2"].value == 2026
    assert plan_sheet["E3"].value == "Q2"
    assert plan_sheet["E4"].value == "Tháng 1"
    assert plan_sheet["E5"].value == 15
    assert plan_sheet["E6"].value == 1


def test_team_account_can_only_read_linked_personnel_assessment(client, admin_headers):
    _import_frameworks(client, admin_headers)
    own = client.post(
        "/api/v1/et/personnel",
        headers=admin_headers,
        json={
            "employee_code": "OWN",
            "full_name": "Own User",
            "position_code": "KNL_ĐK_13",
            "team": "TBĐL",
            "current_level": 1,
            "status": "active",
            "user_id": "TBĐL",
        },
    ).json()
    other = client.post(
        "/api/v1/et/personnel",
        headers=admin_headers,
        json={
            "employee_code": "OTHER",
            "full_name": "Other User",
            "position_code": "KNL_ĐK_14",
            "team": "TBHTĐK",
            "current_level": 1,
            "status": "active",
        },
    ).json()
    own_assessment = client.post(
        "/api/v1/et/assessments",
        headers=admin_headers,
        json={"personnel_id": own["id"], "assessment_period": "2026-Q2"},
    ).json()
    other_assessment = client.post(
        "/api/v1/et/assessments",
        headers=admin_headers,
        json={"personnel_id": other["id"], "assessment_period": "2026-Q2"},
    ).json()
    team_headers = _login(client, "TBĐL", "tbdl-pass")

    assert client.get(f"/api/v1/et/assessments/{own_assessment['id']}", headers=team_headers).status_code == 200
    assert client.get(f"/api/v1/et/assessments/{other_assessment['id']}", headers=team_headers).status_code == 403
    list_response = client.get("/api/v1/et/assessments", headers=team_headers)
    assert list_response.status_code == 200
    assert [row["id"] for row in list_response.json()] == [own_assessment["id"]]
