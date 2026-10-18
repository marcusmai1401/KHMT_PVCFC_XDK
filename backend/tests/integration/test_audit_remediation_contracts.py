from app.db.session import create_session
from app.models.domain import NotificationModel


def _login(client, user_id: str, password: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"user_id": user_id, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_user(client, admin_headers, user_id: str, role: str = "Staff") -> dict[str, str]:
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "id": user_id,
            "display_name": user_id,
            "full_name": user_id,
            "password": "StrongPass123",
            "role": role,
            "team": "TBCH",
        },
    )
    assert created.status_code == 200, created.text
    return _login(client, user_id, "StrongPass123")


def test_capabilities_keep_fi_coordinator_summary_only_and_staff_out(client, admin_headers):
    fi_headers = _create_user(client, admin_headers, "cap-fi", "FI_Coordinator")
    staff_headers = _create_user(client, admin_headers, "cap-staff", "Staff")
    fi_capabilities = client.get("/api/v1/auth/capabilities", headers=fi_headers).json()["capabilities"]
    staff_capabilities = client.get("/api/v1/auth/capabilities", headers=staff_headers).json()["capabilities"]

    assert fi_capabilities["et.summary.read"] is True
    assert fi_capabilities["et.heatmap.read"] is False
    assert staff_capabilities["et.read"] is False
    assert client.get("/api/v1/et/dashboard", headers=staff_headers).status_code == 403


def test_notification_visibility_and_receipts_are_per_user(client, admin_headers):
    user_a_headers = _create_user(client, admin_headers, "notice-a")
    user_b_headers = _create_user(client, admin_headers, "notice-b")
    with create_session() as db:
        private = NotificationModel(id="notice-private", recipient_user_id="notice-a", recipient_role=None, event="PRIVATE", payload={}, read=False)
        role = NotificationModel(id="notice-role", recipient_user_id=None, recipient_role="Staff", event="ROLE", payload={}, read=False)
        broadcast = NotificationModel(id="notice-broadcast", recipient_user_id=None, recipient_role=None, event="BROADCAST", payload={}, read=False)
        db.add_all([private, role, broadcast])
        db.commit()

    a_items = {item["id"]: item for item in client.get("/api/v1/notifications", headers=user_a_headers).json()}
    b_items = {item["id"]: item for item in client.get("/api/v1/notifications", headers=user_b_headers).json()}
    assert set(a_items) == {"notice-private", "notice-role", "notice-broadcast"}
    assert set(b_items) == {"notice-role", "notice-broadcast"}
    assert client.put("/api/v1/notifications/notice-private/read", headers=user_b_headers).status_code == 404
    assert client.put("/api/v1/notifications/notice-private/read", headers=user_a_headers).status_code == 200
    a_after = {item["id"]: item for item in client.get("/api/v1/notifications", headers=user_a_headers).json()}
    assert a_after["notice-private"]["read_status"] == "read"
    assert all(item["read_status"] == "unread" for item in client.get("/api/v1/notifications", headers=user_b_headers).json())


def test_feedback_requires_consent_is_idempotent_and_telemetry_is_allowlisted(client, admin_headers, capsys):
    missing_consent = client.post(
        "/api/v1/feedback",
        headers=admin_headers,
        json={"feedback_type": "loi", "description": "Không gửi", "consent": False},
    )
    assert missing_consent.status_code == 422

    payload = {
        "feedback_type": "gop_y",
        "description": "Mô tả local",
        "context": {"route_template": "/okr/dashboard/:month/:year", "editor_text": "PRIVATE-CANARY"},
        "consent": True,
    }
    first = client.post("/api/v1/feedback", headers={**admin_headers, "Idempotency-Key": "feedback-test-1"}, json=payload)
    second = client.post("/api/v1/feedback", headers={**admin_headers, "Idempotency-Key": "feedback-test-1"}, json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(client.get("/api/v1/feedback", headers=admin_headers).json()) == 1

    telemetry = client.post(
        "/api/v1/okr/client-debug-log",
        headers=admin_headers,
        json={
            "event": "draft_save_failed",
            "message": "PASSWORD-CANARY",
            "data": {
                "event_name": "draft_save_failed",
                "route_template": "/okr/web-input/:team/:month/:year",
                "duration_ms": 123,
                "password": "PASSWORD-CANARY",
                "editor_text": "EDITOR-CANARY",
            },
        },
    )
    assert telemetry.status_code == 200
    assert "duration_ms" in telemetry.json()["accepted_fields"]
    captured = capsys.readouterr().out
    assert "PASSWORD-CANARY" not in captured
    assert "EDITOR-CANARY" not in captured


def test_upload_replay_accepts_original_revision_and_rejects_fake_image(client, admin_headers):
    from io import BytesIO
    from PIL import Image
    headers = _create_user(client, admin_headers, "upload-replay")
    created = client.post("/api/v1/fi/sk-ctkt", headers=headers, json={
        "author_name": "Synthetic", "team": "TBCH", "title": "Replay image",
        "content_description": "Synthetic content", "completion_plan": "T9/2026",
    })
    assert created.status_code == 200, created.text
    record = created.json()
    url = f"/api/v1/fi/sk-ctkt/{record['id']}/images?expected_revision={record['revision']}"
    invalid = client.post(url, headers=headers, files={"file": ("fake.png", b"not an image", "image/png")})
    assert invalid.status_code == 400
    buffer = BytesIO()
    Image.new("RGB", (2, 2), "blue").save(buffer, format="PNG")
    content = buffer.getvalue()
    mismatch = client.post(url, headers=headers, files={"file": ("fake.jpg", content, "image/jpeg")})
    assert mismatch.status_code == 400
    operation_headers = {**headers, "Idempotency-Key": "synthetic-image-replay"}
    first = client.post(url, headers=operation_headers, files={"file": ("valid.png", content, "image/png")})
    replay = client.post(url, headers=operation_headers, files={"file": ("valid.png", content, "image/png")})
    assert first.status_code == replay.status_code == 200, (first.text, replay.text)
    assert first.json() == replay.json()
    assert "file_path" not in first.json()
    assert len(client.get(f"/api/v1/fi/sk-ctkt/{record['id']}/images", headers=headers).json()) == 1


def test_editor_can_save_after_submission_without_resetting_revision(client, admin_headers):
    from tests.integration.test_web_input_api import _valid_payload
    payload = _valid_payload(client, admin_headers)
    url = "/api/v1/okr/web-input/TBCH/9/2026"
    submitted = client.post(url + "/submit", headers=admin_headers, json={"data": payload, "expected_revision": 0})
    assert submitted.status_code == 200, submitted.text
    assert "file_path" not in submitted.json()["report"]
    revision = submitted.json()["server_revision"]
    draft = client.put(url + "/draft", headers=admin_headers, json={"data": payload, "expected_revision": revision})
    assert draft.status_code == 200, draft.text
    assert draft.json()["server_revision"] > revision
    stale = client.put(url + "/draft", headers=admin_headers, json={"data": payload, "expected_revision": revision})
    assert stale.status_code == 409


def test_history_pages_in_sql_and_matches_summary_for_5000_records(client, admin_headers):
    from datetime import datetime, timezone
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.domain import SKCTKTModel
    stamp = datetime(2026, 9, 1, tzinfo=timezone.utc)
    with create_session() as db:
        db.add_all([SKCTKTModel(id=f"history-{index:05}", sk_code=f"FI/09/2026-TBCH-{index:05}",
            title=f"Sáng kiến {index}", author_name="Nhân sự thử", author_user_id="admin", team="TBCH",
            content_description="Dữ liệu giả", completion_plan="Dự kiến tháng 10", status="Approved",
            status_history=[], created_at=stamp, is_historical_import=False) for index in range(5000)])
        db.commit()
    statements = []
    loaded_records = []
    def loaded(session, instance):
        if isinstance(instance, SKCTKTModel):
            loaded_records.append(instance.id)
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(engine, "before_cursor_execute", capture)
    event.listen(Session, "loaded_as_persistent", loaded)
    try:
        response = client.get("/api/v1/fi/history?page=2&page_size=25&q=sang+kien&decisions=approved&completion=pending", headers=admin_headers)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
        event.remove(Session, "loaded_as_persistent", loaded)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["total"] == result["summary"]["approved"] == 5000
    assert len(result["items"]) == 25
    assert len(loaded_records) == 25
    assert result["facets"]["teams"] == [{"value": "TBCH", "count": 5000}]
    assert result["facets"]["authors"][0]["count"] == 5000
    assert result["items"][0]["id"] == "history-04974"
    row_queries = [query for query in statements if query.startswith("SELECT sk_ctkt.id,") and "FROM sk_ctkt" in query]
    assert row_queries and all("LIMIT" in query for query in row_queries)
    assert len(statements) < 12, statements
    beyond = client.get("/api/v1/fi/history?page=999&page_size=25&q=sang+kien", headers=admin_headers).json()
    assert beyond["items"] == [] and beyond["total"] == 5000
    assert beyond["summary"]["approved"] == 5000 and beyond["has_next"] is False
    empty = client.get("/api/v1/fi/history?q=__NO_MATCH__", headers=admin_headers).json()
    assert empty["items"] == [] and empty["total"] == 0
    assert all(value == 0 for value in empty["summary"].values())


def test_render_failure_preserves_committed_editor_content(client, admin_headers, monkeypatch):
    from tests.integration.test_web_input_api import _valid_payload
    from app.services.okr import web_input
    payload = _valid_payload(client, admin_headers)
    monkeypatch.setattr(web_input, "generate_excel_from_web_input", lambda *_: (_ for _ in ()).throw(OSError("synthetic render failure")))
    url = "/api/v1/okr/web-input/TBCH/9/2026"
    response = client.put(url + "/draft", headers=admin_headers, json={"data": payload, "expected_revision": 0})
    assert response.status_code == 200, response.text
    assert response.json()["artifact_status"] == "pending"
    reread = client.get(url, headers=admin_headers)
    assert {item["workshop_kr_code"]: item["implementation_report"] for item in reread.json()["data"]["kr_assessments"]} == {item["workshop_kr_code"]: item["implementation_report"] for item in payload["kr_assessments"]}
