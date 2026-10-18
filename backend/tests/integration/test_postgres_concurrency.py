"""Two HTTP requests, independent DB sessions, real PostgreSQL only."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import func, select

from app.db.session import create_session, engine
from app.models.domain import SKCTKTModel, TeamReportModel
from app.models.domain import User
from app.models.domain import NotificationModel, NotificationReceiptModel, FIMonthlyAllocationModel
from tests.integration.test_web_input_api import _valid_payload

pytestmark = pytest.mark.skipif(engine.dialect.name != "postgresql", reason="requires real PostgreSQL row locks")


def race(*calls):
    barrier = Barrier(len(calls))
    def run(call):
        barrier.wait(timeout=10)
        return call()
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


@pytest.mark.parametrize("operation", ["draft", "submit"])
def test_same_okr_revision_has_one_winner(client, admin_headers, operation):
    payload = _valid_payload(client, admin_headers)
    url = f"/api/v1/okr/web-input/TBCH/9/2026/{operation}"
    method = client.put if operation == "draft" else client.post
    responses = race(*[lambda: method(url, headers=admin_headers, json={"data": payload, "expected_revision": 0}) for _ in range(2)])
    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    with create_session() as db:
        rows = db.scalars(select(TeamReportModel).where(TeamReportModel.team == "TBCH", TeamReportModel.report_month == 9, TeamReportModel.report_year == 2026, TeamReportModel.is_current_version.is_(True))).all()
        assert len(rows) == 1


@pytest.mark.parametrize("same_key", [False, True])
def test_fi_creation_allocates_unique_codes_and_replays_operation(client, admin_headers, same_key):
    payload = {"author_name": "Synthetic", "team": "TBCH", "title": "Concurrent FI", "content_description": "Synthetic only", "completion_plan": "T9/2026"}
    calls = [lambda index=index: client.post("/api/v1/fi/sk-ctkt", headers={**admin_headers, "Idempotency-Key": "parallel-fi-" + ("same" if same_key else str(index))}, json=payload) for index in range(2)]
    responses = race(*calls)
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    ids = {r.json()["id"] for r in responses}
    assert len(ids) == (1 if same_key else 2)
    assert len({r.json()["sk_code"] for r in responses}) == len(ids)
    with create_session() as db:
        assert db.scalar(select(func.count()).select_from(SKCTKTModel)) == len(ids)


def test_et_same_revision_has_one_winner(client, admin_headers):
    person = client.post("/api/v1/et/personnel", headers=admin_headers, json={"employee_code": "PG001", "full_name": "Synthetic PG", "position_code": "KNL_ĐK_14", "team": "TBHTĐK", "current_level": 2, "status": "active"})
    assert person.status_code == 200, person.text
    created = client.post("/api/v1/et/assessments", headers=admin_headers, json={"personnel_id": person.json()["id"], "assessment_period": "2026-Q3"})
    assert created.status_code == 200, created.text
    row = created.json()
    responses = race(*[lambda notes=notes: client.put(f"/api/v1/et/assessments/{row['id']}", headers=admin_headers, json={"items": [], "notes": notes, "expected_revision": row["server_revision"]}) for notes in ["Writer A", "Writer B"]])
    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    winner = next(r.json() for r in responses if r.status_code == 200)
    stored = client.get(f"/api/v1/et/assessments/{row['id']}", headers=admin_headers).json()
    assert stored["notes"] == winner["notes"]
    assert stored["server_revision"] == row["server_revision"] + 1


def test_password_resets_increment_session_version_without_lost_update(client, admin_headers):
    created = client.post("/api/v1/admin/users", headers=admin_headers, json={"id": "pg-reset", "display_name": "Synthetic", "full_name": "Synthetic", "password": "SyntheticPass123", "role": "Staff", "team": "TBCH"})
    assert created.status_code == 200, created.text
    with create_session() as db:
        before = db.get(User, "pg-reset").session_version
    responses = race(*[lambda index=index: client.post("/api/v1/admin/users/pg-reset/reset-password", headers=admin_headers, json={"new_password": f"SyntheticReset{index}123"}) for index in range(2)])
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    with create_session() as db:
        assert db.get(User, "pg-reset").session_version == before + 2


def test_concurrent_notification_receipts_are_idempotent(client, admin_headers):
    with create_session() as db:
        db.add(NotificationModel(id="pg-notice", recipient_user_id=None, recipient_role=None, event="SYNTHETIC", payload={}, read=False))
        db.commit()
    responses = race(*[lambda: client.put("/api/v1/notifications/pg-notice/read", headers=admin_headers) for _ in range(2)])
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    with create_session() as db:
        assert db.scalar(select(func.count()).select_from(NotificationReceiptModel).where(NotificationReceiptModel.notification_id == "pg-notice")) == 1


def test_finalize_and_move_fi_have_a_serializable_outcome(client, admin_headers):
    from datetime import datetime, timezone
    from tests.integration.test_web_input_api import _approved_fi
    payload = _valid_payload(client, admin_headers)
    url = "/api/v1/okr/web-input/TBCH/4/2026"
    submitted = client.post(url + "/submit", headers=admin_headers, json={"data": payload, "expected_revision": 0})
    assert submitted.status_code == 200, submitted.text
    with create_session() as db:
        row = _approved_fi("pg-locked-01", team="TBCH", approved_at=datetime(2026, 4, 20, tzinfo=timezone.utc))
        db.add(row)
        db.commit()
        revision = row.revision
    preview = client.get(url + "/fi-allocation-preview", headers=admin_headers).json()
    lock, move = race(
        lambda: client.post(url + "/lock", headers=admin_headers, json={"reason": "Synthetic concurrency", "expected_revision": submitted.json()["server_revision"], "expected_fi_team_revision": preview["fi_team_revision"], "expected_plan_hash": preview["plan_hash"]}),
        lambda: client.post("/api/v1/fi/sk-ctkt/pg-locked-01/assign-khmt", headers=admin_headers, json={"month": 5, "year": 2026, "expected_revision": revision}),
    )
    assert sorted([lock.status_code, move.status_code]) == [200, 409], [lock.text, move.text]
    with create_session() as db:
        row = db.get(SKCTKTModel, "pg-locked-01")
        report = db.scalar(select(TeamReportModel).where(TeamReportModel.team == "TBCH", TeamReportModel.report_month == 4, TeamReportModel.is_current_version.is_(True)))
        if lock.status_code == 200:
            assert report.report_status == "locked"
            assert (row.khmt_month, row.khmt_year) == (4, 2026)
            assert db.scalar(select(func.count()).select_from(FIMonthlyAllocationModel)) == 1
        else:
            assert report.report_status == "submitted"
            assert (row.khmt_month, row.khmt_year) == (5, 2026)
            assert db.scalar(select(func.count()).select_from(FIMonthlyAllocationModel)) == 0
