from datetime import date, datetime, timedelta, timezone
from io import BytesIO

from openpyxl import load_workbook
from PIL import Image
from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import create_session
from app.models.domain import NotificationModel, SKCTKTModel, SKImageModel, User
from app.services.fi.auto_completion import apply_completion_schedule, factory_today
from app.services.fi.period_guard import lock_period_state, mark_period_locked
from app.services.fi.service import assign_khmt, create_sk_ctkt, transition_sk_ctkt


def _png_bytes(color: tuple[int, int, int] = (24, 144, 72)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (20, 20), color=color).save(buf, format="PNG")
    return buf.getvalue()


def _seed_users_and_login(client):
    users = [
        ("staff_htdk", "Nhân viên TBHTĐK", "Staff", "TBHTĐK"),
        ("staff_htdk_2", "Nhân viên 2 TBHTĐK", "Staff", "TBHTĐK"),
        ("leader_htdk", "Đội trưởng TBHTĐK", "Team_Account", "TBHTĐK"),
        ("leader_tbch", "Đội trưởng TBCH", "Team_Account", "TBCH"),
        ("coord_fi", "Đầu mối FI", "FI_Coordinator", "TBHTĐK"),
        ("workshop_ld", "Lãnh đạo xưởng", "Workshop_Leader", None),
    ]
    with create_session() as db:
        for uid, name, role, team in users:
            db.add(
                User(
                    id=uid,
                    display_name=name,
                    full_name=name,
                    password_hash=hash_password("pass1234"),
                    role=role,
                    team=team,
                    is_active=True,
                )
            )
        db.commit()

    def headers_for(uid: str, password: str = "pass1234") -> dict[str, str]:
        resp = client.post("/api/v1/auth/login", json={"user_id": uid, "password": password})
        assert resp.status_code == 200, resp.text
        return {"Authorization": f"Bearer {resp.json()['access_token']}"}

    return headers_for


def _create_approved_sk(team: str = "TBHTĐK", author_id: str = "staff_htdk", author_name: str = "Nhân viên TBHTĐK") -> SKCTKTModel:
    future_date = factory_today() + timedelta(days=30)
    with create_session() as db:
        record = create_sk_ctkt(
            db,
            {
                "author_name": author_name,
                "author_user_id": author_id,
                "team": team,
                "title": f"SK cải tiến {team}",
                "content_description": "Hiện trạng và giải pháp cải tiến",
                "completion_plan": f"Dự kiến hoàn thành {future_date.strftime('%d/%m/%Y')}",
                "completion_done": False,
                "completion_date": future_date,
                "registration_month": 7,
                "registration_year": 2026,
            },
            author_id,
            submit_immediately=True,
        )
        approved = transition_sk_ctkt(db, record.id, "approve", "admin", "Admin", note="Đồng ý triển khai")
        return approved


def test_execution_permissions_matrix_and_notifications(client, admin_headers):
    headers_for = _seed_users_and_login(client)
    sk = _create_approved_sk(team="TBHTĐK", author_id="staff_htdk")
    today = factory_today()
    next_month = today + timedelta(days=35)

    # Clear setup notifications
    with create_session() as db:
        db.execute(NotificationModel.__table__.delete())
        db.commit()

    # 1. Workshop_Leader is read-only (403)
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("workshop_ld"),
        json={"execution_status": "completed", "completion_date": today.isoformat(), "expected_revision": sk.revision},
    )
    assert res.status_code == 403

    # 2. Other-team Team_Account (TBCH) is blocked (403)
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("leader_tbch"),
        json={"execution_status": "completed", "completion_date": today.isoformat(), "expected_revision": sk.revision},
    )
    assert res.status_code == 403

    # 3. Same-team non-author Staff is blocked (403)
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("staff_htdk_2"),
        json={"execution_status": "completed", "completion_date": today.isoformat(), "expected_revision": sk.revision},
    )
    assert res.status_code == 403

    # 4. Same-team Team_Account (TBHTĐK) CAN update and triggers notification to author!
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("leader_htdk"),
        json={
            "execution_status": "completed",
            "completion_date": today.isoformat(),
            "execution_note": "Đã lắp đặt hoàn chỉnh cover bảo vệ",
            "expected_revision": sk.revision,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "Approved"
    assert body["execution_status"] == "completed"
    assert body["execution_note"] == "Đã lắp đặt hoàn chỉnh cover bảo vệ"
    assert body["execution_updated_by"] == "leader_htdk"
    assert body["execution_state"]["status"] == "completed"
    assert body["execution_state"]["is_auto_done"] is False
    assert body["execution_state"]["can_update"] is True
    rev = body["server_revision"]

    with create_session() as db:
        notifs = db.scalars(select(NotificationModel).where(NotificationModel.event == "SK_EXECUTION_UPDATED")).all()
        assert len(notifs) == 1
        assert notifs[0].recipient_user_id == "staff_htdk"

    # 5. Author (Staff) CAN update back to paused (no self-notification)
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("staff_htdk"),
        json={
            "execution_status": "paused",
            "completion_date": next_month.isoformat(),
            "execution_note": "Chờ dừng máy bảo dưỡng",
            "expected_revision": rev,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["execution_status"] == "paused"
    assert body["completed_at"] is None
    assert body["execution_state"]["status"] == "paused"
    rev = body["server_revision"]

    # 6. FI_Coordinator CAN update any team's Approved SK
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("coord_fi"),
        json={
            "execution_status": "in_progress",
            "completion_date": next_month.isoformat(),
            "execution_note": "Đã có vật tư, triển khai tiếp",
            "expected_revision": rev,
        },
    )
    assert res.status_code == 200, res.text
    rev = res.json()["server_revision"]

    # 7. Admin CAN update
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=admin_headers,
        json={
            "execution_status": "completed",
            "completion_date": today.isoformat(),
            "execution_note": "Admin ghi nhận hoàn thành",
            "expected_revision": rev,
        },
    )
    assert res.status_code == 200, res.text

    # 8. FI_Coordinator CAN update their OWN Approved SK
    own_sk = _create_approved_sk(team="TBHTĐK", author_id="coord_fi", author_name="Đầu mối FI")
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{own_sk.id}/execution",
        headers=headers_for("coord_fi"),
        json={
            "execution_status": "completed",
            "completion_date": today.isoformat(),
            "expected_revision": own_sk.revision,
        },
    )
    assert res.status_code == 200, res.text

    # 9. Legacy HIST-* SK can be updated by same-team Team_Account without notifying import actor
    with create_session() as db:
        legacy = SKCTKTModel(
            id="sk-hist-exec",
            sk_code="HIST-TBHTĐK-01",
            title="Legacy TBHTĐK",
            author_name="Người không tồn tại",
            author_user_id="historical-import",
            team="TBHTĐK",
            content_description="Nội dung cũ",
            completion_plan="Dự kiến T12/2026",
            status="Approved",
            status_history=[{"from_status": None, "to_status": "Approved", "changed_by": "historical-import"}],
            is_public=True,
            is_historical_import=True,
        )
        db.add(legacy)
        db.execute(NotificationModel.__table__.delete())
        db.commit()
        legacy_rev = legacy.revision

    res = client.put(
        "/api/v1/fi/sk-ctkt/sk-hist-exec/execution",
        headers=headers_for("leader_htdk"),
        json={"execution_status": "completed", "completion_date": today.isoformat(), "expected_revision": legacy_rev},
    )
    assert res.status_code == 200, res.text
    with create_session() as db:
        assert db.scalars(select(NotificationModel).where(NotificationModel.event == "SK_EXECUTION_UPDATED")).all() == []


def test_execution_validation_and_optimistic_concurrency(client, admin_headers):
    headers_for = _seed_users_and_login(client)
    sk = _create_approved_sk(team="TBHTĐK", author_id="staff_htdk")
    today = factory_today()

    # Future completion_date rejected for completed
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("leader_htdk"),
        json={
            "execution_status": "completed",
            "completion_date": (today + timedelta(days=2)).isoformat(),
            "expected_revision": sk.revision,
        },
    )
    assert res.status_code == 400

    # Past/today due date rejected for in_progress on Approved
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("leader_htdk"),
        json={
            "execution_status": "in_progress",
            "completion_date": today.isoformat(),
            "expected_revision": sk.revision,
        },
    )
    assert res.status_code == 400

    # Stale revision returns 409 VERSION_CONFLICT
    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("leader_htdk"),
        json={
            "execution_status": "completed",
            "completion_date": today.isoformat(),
            "expected_revision": sk.revision + 99,
        },
    )
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "VERSION_CONFLICT"


def test_locked_khmt_period_allows_execution_and_completion_images_but_blocks_khmt_mutation(client, admin_headers):
    headers_for = _seed_users_and_login(client)
    sk = _create_approved_sk(team="TBHTĐK", author_id="staff_htdk")
    with create_session() as db:
        assigned = assign_khmt(db, sk.id, 5, 2026, "admin", "Admin")
        mark_period_locked(lock_period_state(db, "TBHTĐK", 5, 2026), "admin", "Chốt kỳ T5/2026")
        db.commit()
        rev = assigned.revision

    # KHMT unassignment is still blocked with 409 PERIOD_LOCKED
    locked_khmt = client.delete(
        f"/api/v1/fi/sk-ctkt/{sk.id}/assign-khmt?expected_revision={rev}",
        headers=headers_for("leader_htdk"),
    )
    assert locked_khmt.status_code == 409
    assert locked_khmt.json()["detail"]["code"] == "PERIOD_LOCKED"

    # Execution update succeeds even though KHMT period is locked!
    today = factory_today()
    exec_res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("leader_htdk"),
        json={
            "execution_status": "completed",
            "completion_date": today.isoformat(),
            "execution_note": "Hoàn thành ngoài hiện trường",
            "expected_revision": rev,
        },
    )
    assert exec_res.status_code == 200, exec_res.text
    rev = exec_res.json()["server_revision"]
    assert exec_res.json()["khmt_month"] == 5
    assert exec_res.json()["consider_for_khmt"] is True

    # Completion image upload succeeds on locked period and stores stage="completion"
    img_res = client.post(
        f"/api/v1/fi/sk-ctkt/{sk.id}/images?expected_revision={rev}&stage=completion",
        headers=headers_for("leader_htdk"),
        files={"file": ("after-install.png", _png_bytes(), "image/png")},
    )
    assert img_res.status_code == 200, img_res.text
    img_body = img_res.json()
    assert img_body["stage"] == "completion"
    rev = img_body["server_revision"]

    # Deleting completion image succeeds on locked period
    del_res = client.delete(
        f"/api/v1/fi/sk-ctkt/{sk.id}/images/{img_body['id']}?expected_revision={rev}",
        headers=headers_for("leader_htdk"),
    )
    assert del_res.status_code == 200, del_res.text
    assert del_res.json()["deleted"] is True


def test_locked_khmt_period_still_blocks_pre_approval_plan_updates(client, admin_headers):
    """Only Approved/Completed SKs bypass the KHMT period lock; a pre-approval SK
    sitting in a locked period keeps the hard lock on the execution endpoint."""
    headers_for = _seed_users_and_login(client)
    sk = _create_approved_sk(team="TBHTĐK", author_id="staff_htdk")
    with create_session() as db:
        assign_khmt(db, sk.id, 6, 2026, "admin", "Admin")
        mark_period_locked(lock_period_state(db, "TBHTĐK", 6, 2026), "admin", "Chốt kỳ T6/2026")
        record = db.get(SKCTKTModel, sk.id)
        record.status = "Deferred"
        db.commit()
        rev = record.revision

    res = client.put(
        f"/api/v1/fi/sk-ctkt/{sk.id}/execution",
        headers=headers_for("staff_htdk"),
        json={
            "execution_status": "in_progress",
            "completion_date": (factory_today() + timedelta(days=10)).isoformat(),
            "expected_revision": rev,
        },
    )
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "PERIOD_LOCKED"
    with create_session() as db:
        assert db.get(SKCTKTModel, sk.id).revision == rev


def test_image_stage_separation_and_registration_protection(client, admin_headers):
    headers_for = _seed_users_and_login(client)
    future_date = factory_today() + timedelta(days=30)
    with create_session() as db:
        record = create_sk_ctkt(
            db,
            {
                "author_name": "Nhân viên TBHTĐK",
                "author_user_id": "staff_htdk",
                "team": "TBHTĐK",
                "title": "SK có ảnh đăng ký",
                "content_description": "Mô tả",
                "completion_plan": f"Dự kiến hoàn thành {future_date.strftime('%d/%m/%Y')}",
                "completion_done": False,
                "completion_date": future_date,
                "registration_month": 7,
                "registration_year": 2026,
            },
            "staff_htdk",
            submit_immediately=True,
        )
        sk_id = record.id
        rev = record.revision

    # Author uploads registration image before approval
    reg_res = client.post(
        f"/api/v1/fi/sk-ctkt/{sk_id}/images?expected_revision={rev}",
        headers=headers_for("staff_htdk"),
        files={"file": ("before.png", _png_bytes((200, 40, 40)), "image/png")},
    )
    assert reg_res.status_code == 200, reg_res.text
    reg_img = reg_res.json()
    assert reg_img["stage"] == "registration"
    rev = reg_img["server_revision"]

    # Approve SK
    app_res = client.post(
        f"/api/v1/fi/sk-ctkt/{sk_id}/approve",
        headers=admin_headers,
        json={"note": "Duyệt", "expected_revision": rev},
    )
    assert app_res.status_code == 200, app_res.text
    rev = app_res.json()["server_revision"]

    # Non-Admin cannot upload registration-stage images after approval (403)
    blocked_reg = client.post(
        f"/api/v1/fi/sk-ctkt/{sk_id}/images?expected_revision={rev}&stage=registration",
        headers=headers_for("leader_htdk"),
        files={"file": ("late-reg.png", _png_bytes((20, 160, 60)), "image/png")},
    )
    assert blocked_reg.status_code == 403

    # Upload on Approved SK with stage=completion succeeds for same-team Team_Account
    comp_res = client.post(
        f"/api/v1/fi/sk-ctkt/{sk_id}/images?expected_revision={rev}&stage=completion",
        headers=headers_for("leader_htdk"),
        files={"file": ("after.png", _png_bytes((20, 160, 60)), "image/png")},
    )
    assert comp_res.status_code == 200, comp_res.text
    comp_img = comp_res.json()
    assert comp_img["stage"] == "completion"
    rev = comp_img["server_revision"]

    # Other team cannot upload completion image
    blocked_up = client.post(
        f"/api/v1/fi/sk-ctkt/{sk_id}/images?expected_revision={rev}&stage=completion",
        headers=headers_for("leader_tbch"),
        files={"file": ("other.png", _png_bytes(), "image/png")},
    )
    assert blocked_up.status_code == 403

    # Non-Admin (even Author / Team_Account / FI_Coordinator) CANNOT delete registration image after approval
    for actor in ("staff_htdk", "leader_htdk", "coord_fi"):
        del_reg = client.delete(
            f"/api/v1/fi/sk-ctkt/{sk_id}/images/{reg_img['id']}?expected_revision={rev}",
            headers=headers_for(actor),
        )
        assert del_reg.status_code == 403, f"{actor} should not delete registration image"

    # FI_Coordinator CAN delete completion image
    del_comp = client.delete(
        f"/api/v1/fi/sk-ctkt/{sk_id}/images/{comp_img['id']}?expected_revision={rev}",
        headers=headers_for("coord_fi"),
    )
    assert del_comp.status_code == 200, del_comp.text
    rev = client.get(f"/api/v1/fi/sk-ctkt/{sk_id}", headers=admin_headers).json()["server_revision"]

    # Admin CAN delete registration image
    del_reg_admin = client.delete(
        f"/api/v1/fi/sk-ctkt/{sk_id}/images/{reg_img['id']}?expected_revision={rev}",
        headers=admin_headers,
    )
    assert del_reg_admin.status_code == 200, del_reg_admin.text


def test_auto_completion_allowlist_and_history_filters_and_export(client, admin_headers):
    _seed_users_and_login(client)
    today = date(2026, 11, 24)
    with create_session() as db:
        def make_row(rid: str, status: str, plan: str, exec_status: str | None = None, completed_at=None, note=None):
            return SKCTKTModel(
                id=rid,
                sk_code=f"FI/07/2026-TBHTĐK-{rid}",
                title=f"Title {rid}",
                author_name="Nhân viên TBHTĐK",
                author_user_id="staff_htdk",
                team="TBHTĐK",
                content_description="Nội dung",
                completion_plan=plan,
                status=status,
                execution_status=exec_status,
                execution_note=note,
                completed_at=completed_at,
                status_history=[{"from_status": None, "to_status": status, "changed_by": "staff_htdk", "comments": {"registration_month": 7, "registration_year": 2026}}],
                created_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
            )

        db.add_all(
            [
                make_row("app-auto", "Approved", "Dự kiến hoàn thành 15/10/2026"),
                make_row("app-paused", "Approved", "Dự kiến hoàn thành 15/10/2026", exec_status="paused", note="Chờ dừng máy"),
                make_row("app-inprog", "Approved", "Dự kiến hoàn thành 31/12/2026", exec_status="in_progress"),
                # Legacy approved row (pre-0019) keeps execution_status NULL and must still
                # count as in progress in SQL summaries (NULL-safe comparisons).
                make_row("app-legacy", "Approved", "Dự kiến hoàn thành 31/12/2026"),
                make_row(
                    "app-confirmed",
                    "Approved",
                    "Đã hoàn thành 01/11/2026",
                    exec_status="completed",
                    completed_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
                    note="Đã nghiệm thu",
                ),
                make_row("sub-past", "Submitted", "Dự kiến hoàn thành 15/10/2026"),
                make_row("def-past", "Deferred", "Dự kiến hoàn thành 15/10/2026"),
                make_row("rej-past", "Rejected", "Dự kiến hoàn thành 15/10/2026"),
            ]
        )
        db.add(
            SKImageModel(
                id="img-comp-1",
                sk_ctkt_id="app-confirmed",
                file_name="done.png",
                file_path="/tmp/done.png",
                file_size=100,
                content_type="image/png",
                uploaded_by="leader_htdk",
                stage="completion",
            )
        )
        db.commit()

        changed = apply_completion_schedule(db, today=today)
        assert changed == 1
        assert db.get(SKCTKTModel, "app-auto").execution_status == "auto_completed"
        assert db.get(SKCTKTModel, "app-auto").completed_at is not None
        assert db.get(SKCTKTModel, "app-paused").completed_at is None
        assert db.get(SKCTKTModel, "app-paused").execution_status == "paused"
        assert db.get(SKCTKTModel, "sub-past").completed_at is None
        assert db.get(SKCTKTModel, "def-past").completed_at is None
        assert db.get(SKCTKTModel, "rej-past").completed_at is None

    # Disjunctive facets.decisions stays populated even when filtered to decisions=approved
    hist = client.get("/api/v1/fi/history?decisions=approved", headers=admin_headers).json()
    assert hist["total"] == 5
    assert hist["facets"]["decisions"] == {"approved": 5, "rejected": 1, "deferred": 1, "pending": 1}
    assert hist["summary"]["approved_completed_count"] == 2
    assert hist["summary"]["approved_confirmed_completed_count"] == 1
    assert hist["summary"]["approved_auto_done_count"] == 1
    assert hist["summary"]["approved_in_progress_count"] == 2
    assert hist["summary"]["approved_paused_count"] == 1
    assert hist["summary"]["not_completed"] == 3

    pending_res = client.get("/api/v1/fi/history?decisions=approved&completion=pending", headers=admin_headers).json()
    assert sorted(item["id"] for item in pending_res["items"]) == ["app-inprog", "app-legacy", "app-paused"]

    # completion=auto_done returns only app-auto
    auto_res = client.get("/api/v1/fi/history?completion=auto_done", headers=admin_headers).json()
    assert [item["id"] for item in auto_res["items"]] == ["app-auto"]
    assert auto_res["items"][0]["execution_state"]["is_auto_done"] is True

    # completion=paused returns only app-paused
    paused_res = client.get("/api/v1/fi/history?completion=paused", headers=admin_headers).json()
    assert [item["id"] for item in paused_res["items"]] == ["app-paused"]
    assert paused_res["items"][0]["execution_state"]["status"] == "paused"

    # Dashboard selected_year_totals includes approved_* breakdown
    dash = client.get("/api/v1/fi/dashboard?year=2026", headers=admin_headers).json()
    assert dash["selected_year_totals"]["approved"] == 5
    assert dash["selected_year_totals"]["approved_completed_count"] == 2
    assert dash["selected_year_totals"]["approved_auto_done_count"] == 1
    assert dash["selected_year_totals"]["approved_paused_count"] == 1
    assert dash["selected_year_totals"]["approved_in_progress_count"] == 2

    # Excel export includes new execution columns and completion filter support
    exp_resp = client.get("/api/v1/fi/reports/export?decisions=approved", headers=admin_headers)
    assert exp_resp.status_code == 200
    wb = load_workbook(BytesIO(exp_resp.content))
    ws = wb["Du lieu FI"]
    headers = [cell.value for cell in ws[4]]
    assert "Tình hình thực hiện" in headers
    assert "Ghi chú thực hiện" in headers
    assert "Ảnh hoàn thành" in headers
    assert headers[-1] == "Ghi chú quyết định"
    rows_by_code = {row[1]: row for row in ws.iter_rows(min_row=5, values_only=True)}
    exec_col = headers.index("Tình hình thực hiện")
    note_col = headers.index("Ghi chú thực hiện")
    img_col = headers.index("Ảnh hoàn thành")
    assert rows_by_code["FI/07/2026-TBHTĐK-app-auto"][exec_col] == "Đã hoàn thành (tự ghi nhận)"
    assert rows_by_code["FI/07/2026-TBHTĐK-app-paused"][exec_col] == "Tạm dừng"
    assert rows_by_code["FI/07/2026-TBHTĐK-app-paused"][note_col] == "Chờ dừng máy"
    assert rows_by_code["FI/07/2026-TBHTĐK-app-confirmed"][exec_col] == "Đã hoàn thành"
    assert rows_by_code["FI/07/2026-TBHTĐK-app-confirmed"][img_col] == 1
