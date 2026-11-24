"""Admin "Kiểm thử" sandbox behaviour when the server runs in production.

These tests clone from whatever the main test database is, so the PostgreSQL CI
suite also exercises the PostgreSQL -> SQLite sandbox copy used in production.
"""
from io import BytesIO
from pathlib import Path

from PIL import Image

from app.core.config import settings
from app.db.session import create_session, sandbox_dir
from app.models.domain import SKCTKTModel, SKImageModel, User
from app.services.sandbox import UNUSABLE_PASSWORD_HASH


def _png() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (12, 12), color=(30, 120, 60)).save(buf, format="PNG")
    return buf.getvalue()


def _production(monkeypatch, *, sandbox_enabled: bool) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "sandbox_enabled", sandbox_enabled)


def _enter(client, admin_headers) -> dict[str, str]:
    response = client.post("/api/v1/auth/sandbox/enter", headers=admin_headers)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_production_sandbox_disabled_hides_and_rejects_everything(client, admin_headers, monkeypatch):
    sandbox_headers = _enter(client, admin_headers)  # issued while still in development
    _production(monkeypatch, sandbox_enabled=False)

    caps = client.get("/api/v1/auth/capabilities", headers=admin_headers).json()["capabilities"]
    assert caps["sandbox.enter"] is False
    assert client.post("/api/v1/auth/sandbox/enter", headers=admin_headers).status_code == 404
    # A sandbox token minted earlier stops working as soon as the flag is off.
    assert client.get("/api/v1/auth/me", headers=sandbox_headers).status_code == 401


def test_production_sandbox_enabled_is_admin_only_isolated_and_scrubbed(client, admin_headers, monkeypatch):
    _production(monkeypatch, sandbox_enabled=True)

    caps = client.get("/api/v1/auth/capabilities", headers=admin_headers).json()["capabilities"]
    assert caps["sandbox.enter"] is True
    # The shared "test" password never opens a session in production.
    assert client.post("/api/v1/auth/login", json={"user_id": "test", "password": "PVCFC@123"}).status_code == 401

    sandbox_headers = _enter(client, admin_headers)
    me = client.get("/api/v1/auth/me", headers=sandbox_headers).json()
    assert me["sandbox"] is True
    sandbox_caps = client.get("/api/v1/auth/capabilities", headers=sandbox_headers).json()["capabilities"]
    assert sandbox_caps["sandbox.enter"] is False

    reset = client.post("/api/v1/auth/sandbox/reset", headers=sandbox_headers)
    assert reset.status_code == 200, reset.text
    with create_session(sandbox=True) as db:
        hashes = {user.id: user.password_hash for user in db.query(User).all()}
    assert hashes, "sandbox clone has no users"
    assert set(hashes.values()) == {UNUSABLE_PASSWORD_HASH}
    # Real passwords therefore do not work against the sandbox copy either.
    assert client.post(
        "/api/v1/auth/login",
        headers=sandbox_headers,
        json={"user_id": "admin", "password": "admin-pass"},
    ).status_code == 401

    with create_session() as db:
        production_count = db.query(SKCTKTModel).count()
    created = client.post(
        "/api/v1/fi/sk-ctkt",
        headers=sandbox_headers,
        json={
            "author_name": "Kiểm thử",
            "team": "TBCH",
            "title": "Chỉ trong sandbox",
            "content_description": "Không được ghi vào production",
            "completion_plan": "T12/2026",
        },
    )
    assert created.status_code == 200, created.text
    with create_session() as db:
        assert db.query(SKCTKTModel).count() == production_count

    # Only Admins can open the sandbox.
    client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={"id": "staff_sb", "display_name": "Staff", "full_name": "Staff", "password": "StaffPass123",
              "role": "Staff", "team": "TBCH", "must_change_password": False},
    )
    staff = client.post("/api/v1/auth/login", json={"user_id": "staff_sb", "password": "StaffPass123"}).json()
    staff_headers = {"Authorization": f"Bearer {staff['access_token']}"}
    assert client.post("/api/v1/auth/sandbox/enter", headers=staff_headers).status_code == 403


def test_sandbox_never_deletes_production_image_files(client, admin_headers, monkeypatch):
    _production(monkeypatch, sandbox_enabled=True)
    created = client.post(
        "/api/v1/fi/sk-ctkt",
        headers=admin_headers,
        json={
            "author_name": "Quản trị",
            "team": "TBCH",
            "title": "SK có ảnh thật",
            "content_description": "Ảnh nằm trong storage production",
            "completion_plan": "T12/2026",
        },
    ).json()
    upload = client.post(
        f"/api/v1/fi/sk-ctkt/{created['id']}/images?expected_revision={created['revision']}",
        headers=admin_headers,
        files={"file": ("real.png", _png(), "image/png")},
    )
    assert upload.status_code == 200, upload.text
    image_id = upload.json()["id"]
    with create_session() as db:
        production_file = Path(db.get(SKImageModel, image_id).file_path)
    assert production_file.exists()

    sandbox_headers = _enter(client, admin_headers)
    assert client.post("/api/v1/auth/sandbox/reset", headers=sandbox_headers).status_code == 200
    detail = client.get(f"/api/v1/fi/sk-ctkt/{created['id']}", headers=sandbox_headers).json()

    # Deleting the cloned image row in the sandbox keeps the production file.
    deleted = client.delete(
        f"/api/v1/fi/sk-ctkt/{created['id']}/images/{image_id}?expected_revision={detail['server_revision']}",
        headers=sandbox_headers,
    )
    assert deleted.status_code == 200, deleted.text
    assert production_file.exists()
    with create_session() as db:
        assert db.get(SKImageModel, image_id) is not None

    # New sandbox uploads are written under storage/sandbox, never next to production files.
    detail = client.get(f"/api/v1/fi/sk-ctkt/{created['id']}", headers=sandbox_headers).json()
    sandbox_upload = client.post(
        f"/api/v1/fi/sk-ctkt/{created['id']}/images?expected_revision={detail['server_revision']}",
        headers=sandbox_headers,
        files={"file": ("sandbox.png", _png(), "image/png")},
    )
    assert sandbox_upload.status_code == 200, sandbox_upload.text
    with create_session(sandbox=True) as db:
        sandbox_file = Path(db.get(SKImageModel, sandbox_upload.json()["id"]).file_path)
    assert sandbox_file.resolve().is_relative_to(sandbox_dir.resolve())

    # Deleting the whole SK in the sandbox also leaves the production file alone.
    detail = client.get(f"/api/v1/fi/sk-ctkt/{created['id']}", headers=sandbox_headers).json()
    removed = client.delete(
        f"/api/v1/fi/sk-ctkt/{created['id']}?expected_revision={detail['server_revision']}",
        headers=sandbox_headers,
    )
    assert removed.status_code in {200, 204}, removed.text
    assert production_file.exists()
