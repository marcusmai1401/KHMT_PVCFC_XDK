from io import BytesIO

from openpyxl import load_workbook


def _login(client, user_id: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"user_id": user_id, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _valid_payload(client, headers):
    mapping = client.get("/api/v1/okr/kr-mapping", headers=headers)
    assert mapping.status_code == 200, mapping.text
    return {
        "kr_assessments": [
            {
                "workshop_kr_code": item["workshop_kr_code"],
                "implementation_report": f"Đã thực hiện {item['workshop_kr_code']}",
                "team_self_assessment": "Hoàn thành",
                "notes": "",
            }
            for item in mapping.json()
        ],
        "arising_work": [{"content": "Hoàn thành xử lý công việc phát sinh", "status": "Hoàn thành"}],
        "monthly_conclusion": {
            "discipline_status": "OK",
            "discipline_description": "",
            "overall_assessment": "Hoàn thành nhiệm vụ",
            "detailed_description": "",
        },
        "objective_overrides": {"O1": "Hoàn thành tốt nhiệm vụ"},
    }


def test_web_input_draft_submit_lock_export_flow(client):
    headers = _login(client, "admin", "admin-pass")
    payload = _valid_payload(client, headers)

    draft = client.put(
        "/api/v1/okr/web-input/TBCH/4/2026/draft",
        headers=headers,
        json={"data": {**payload, "kr_assessments": payload["kr_assessments"][:2]}, "expected_version": None},
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["status"] == "Đang nhập"
    assert draft.json()["version"] == 1
    draft_report_id = draft.json()["report"]["id"]

    admin_headers = headers
    manager_reports = client.get("/api/v1/okr/reports", headers=admin_headers)
    assert manager_reports.status_code == 200, manager_reports.text
    assert manager_reports.json() == []
    draft_preview = client.get(f"/api/v1/okr/reports/{draft_report_id}/preview", headers=admin_headers)
    assert draft_preview.status_code == 403

    conflict = client.put(
        "/api/v1/okr/web-input/TBCH/4/2026/draft",
        headers=headers,
        json={"data": payload, "expected_version": 999},
    )
    assert conflict.status_code == 409

    submitted = client.post(
        "/api/v1/okr/web-input/TBCH/4/2026/submit",
        headers=headers,
        json={"data": payload},
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "Đã gửi"
    assert "Mục tiêu ĐK.O1.TBCH.O1: Hoàn thành tốt nhiệm vụ" in submitted.json()["email_text"]

    dashboard = client.get("/api/v1/okr/dashboard/4/2026", headers=headers)
    assert dashboard.status_code == 200, dashboard.text
    tbch = next(row for row in dashboard.json()["teams"] if row["team"] == "TBCH")
    assert tbch["monthly_assessment"] == "Hoàn thành nhiệm vụ"

    excel = client.get("/api/v1/okr/web-input/TBCH/4/2026/export/excel", headers=headers)
    assert excel.status_code == 200, excel.text
    workbook = load_workbook(BytesIO(excel.content), read_only=True)
    assert workbook.sheetnames
    assert any(
        cell == "Đã thực hiện O1.KR1"
        for sheet in workbook.worksheets
        for row in sheet.iter_rows(values_only=True)
        for cell in row
    )

    email = client.get("/api/v1/okr/web-input/TBCH/4/2026/export/email", headers=headers)
    assert email.status_code == 200, email.text
    assert email.json()["text"].count("Mục tiêu ĐK.") == 6

    fi_headers = _login(client, "fi", "fi-pass")
    fi_email = client.get("/api/v1/okr/web-input/TBCH/4/2026/export/email", headers=fi_headers)
    assert fi_email.status_code == 200, fi_email.text
    fi_excel = client.get("/api/v1/okr/web-input/TBCH/4/2026/export/excel", headers=fi_headers)
    assert fi_excel.status_code == 200, fi_excel.text

    manager_reports_after_submit = client.get("/api/v1/okr/reports", headers=admin_headers)
    assert manager_reports_after_submit.status_code == 200
    assert [report["report_status"] for report in manager_reports_after_submit.json()] == ["submitted"]

    locked = client.post(
        "/api/v1/okr/web-input/TBCH/4/2026/lock",
        headers=admin_headers,
        json={"reason": "Chốt tháng"},
    )
    assert locked.status_code == 200, locked.text
    assert locked.json()["status"] == "Đã chốt"

    blocked = client.put(
        "/api/v1/okr/web-input/TBCH/4/2026/draft",
        headers=headers,
        json={"data": payload, "expected_version": None},
    )
    assert blocked.status_code == 409

    unlocked = client.post(
        "/api/v1/okr/web-input/TBCH/4/2026/unlock",
        headers=admin_headers,
        json={"reason": "Mở để chỉnh sửa"},
    )
    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()["status"] == "Đã gửi"


def test_team_account_cannot_access_other_team_web_input(client):
    headers = _login(client, "TBCH", "tbch-pass")
    response = client.get("/api/v1/okr/web-input/TBHTĐK/4/2026", headers=headers)
    assert response.status_code == 403


def test_team_account_cannot_write_web_input(client):
    headers = _login(client, "TBCH", "tbch-pass")
    payload = _valid_payload(client, headers)

    draft = client.put(
        "/api/v1/okr/web-input/TBCH/4/2026/draft",
        headers=headers,
        json={"data": payload, "expected_version": None},
    )
    assert draft.status_code == 403

    submitted = client.post(
        "/api/v1/okr/web-input/TBCH/4/2026/submit",
        headers=headers,
        json={"data": payload},
    )
    assert submitted.status_code == 403


def test_web_input_submit_returns_validation_errors(client):
    headers = _login(client, "admin", "admin-pass")
    response = client.post(
        "/api/v1/okr/web-input/TBCH/4/2026/submit",
        headers=headers,
        json={
            "data": {
                "kr_assessments": [
                    {
                        "workshop_kr_code": "O1.KR1",
                        "implementation_report": "",
                        "team_self_assessment": "Hoàn thành",
                        "notes": "",
                    }
                ],
                "arising_work": [],
                "monthly_conclusion": {
                    "discipline_status": "OK",
                    "discipline_description": "",
                    "overall_assessment": "Hoàn thành nhiệm vụ",
                    "detailed_description": "",
                },
                "objective_overrides": {},
            }
        },
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error_code"] == "VALIDATION_ERROR"
    assert any(item["kr_code"] == "O1.KR1" for item in detail["details"])
