import os
from pathlib import Path
import tempfile

os.environ.setdefault("OKR_DATABASE_URL", f"sqlite:///{Path(tempfile.gettempdir()) / 'okr_automation_tests.db'}")
os.environ.setdefault("OKR_BOOTSTRAP_ADMIN_ID", "admin")
os.environ.setdefault("OKR_BOOTSTRAP_ADMIN_PASSWORD", "admin-pass")
os.environ.setdefault("OKR_BOOTSTRAP_ADMIN_NAME", "Test Admin")
os.environ.setdefault("OKR_JWT_SECRET", "test-secret")

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
