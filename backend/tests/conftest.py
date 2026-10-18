import os
from pathlib import Path
import json


def validate_test_environment():
    """Fail before importing any module that constructs an engine or storage."""
    manifest_path = os.environ.get("OKR_TEST_MANIFEST")
    if not manifest_path:
        raise RuntimeError("Use python scripts/run_isolated_checks.py; test manifest required")
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    run_dir = Path(manifest["run_dir"]).resolve()
    database = Path(manifest["database_path"]).resolve()
    storage = Path(manifest["storage_path"]).resolve()
    if manifest.get("synthetic") is not True or Path(manifest_path).resolve().parent != run_dir:
        raise RuntimeError("Invalid synthetic test manifest")
    if database != run_dir / "sandbox.sqlite3" or storage != run_dir / "storage":
        raise RuntimeError("Test database/storage escaped the run directory")
    repo = Path(__file__).resolve().parents[2]
    if run_dir == repo or run_dir == repo / "storage" or (repo / "storage") in run_dir.parents:
        raise RuntimeError("Refusing production storage")
    expected_database_url = f"sqlite:///{database.as_posix()}"
    postgres_database = manifest.get("postgres_database")
    if postgres_database:
        import re
        local = manifest.get("postgres_local") is True
        flag = "OKR_TEST_POSTGRES_LOCAL" if local else "OKR_TEST_POSTGRES_CI"
        if os.environ.get(flag) != "true" or not re.fullmatch(r"okr_audit_[0-9a-f]{32}", postgres_database):
            raise RuntimeError("Invalid ephemeral PostgreSQL identity")
        port = manifest.get("postgres_port", 5432)
        if local and (not (run_dir / "postgres-data" / "PG_VERSION").is_file() or not isinstance(port, int) or not 1024 <= port <= 65535):
            raise RuntimeError("Missing isolated PostgreSQL cluster")
        expected_database_url = f"postgresql+psycopg://okr:ci-only-password@127.0.0.1:{port}/{postgres_database}"
    if os.environ.get("OKR_DATABASE_URL") != expected_database_url:
        raise RuntimeError("Database differs from test manifest")
    if Path(os.environ.get("OKR_STORAGE_DIR", "")).resolve() != storage:
        raise RuntimeError("Storage differs from test manifest")
    if os.environ.get("OKR_LLM_ENABLED") != "false" or os.environ.get("OKR_REDIS_URL"):
        raise RuntimeError("External services must be disabled in tests")


validate_test_environment()

import pytest
from fastapi.testclient import TestClient

from app.db.session import Base, create_session, engine, sandbox_engine
from app.main import app
from app.services.bootstrap import seed_baseline


def reset_database() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
    with create_session() as db:
        seed_baseline(db)
    Base.metadata.drop_all(bind=sandbox_engine)
    Base.metadata.create_all(bind=sandbox_engine)


@pytest.fixture()
def db_session():
    reset_database()
    with create_session() as db:
        yield db


@pytest.fixture()
def client():
    reset_database()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def admin_headers(client):
    response = client.post("/api/v1/auth/login", json={"user_id": "admin", "password": "admin-pass"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
