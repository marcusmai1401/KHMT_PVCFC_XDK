"""Upgrade a synthetic pre-remediation schema with managed legacy rows."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.session import engine
from app.models.domain import User, TeamReportModel, SKCTKTModel, SKImageModel, NotificationModel, FIMonthlyAllocationModel
from app.core.security import hash_password, verify_password


@pytest.fixture
def migration_connection(tmp_path):
    if engine.dialect.name == "postgresql":
        schema = "audit_legacy_" + uuid4().hex
        with engine.connect() as connection:
            connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(sa.text(f'SET search_path TO "{schema}"'))
            connection.commit()
            try:
                yield connection
            finally:
                connection.rollback()
                connection.execute(sa.text('SET search_path TO public'))
                connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
                connection.commit()
    else:
        isolated = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.sqlite3'}")
        with isolated.connect() as connection:
            yield connection
        isolated.dispose()


def configuration(connection):
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    config.attributes["connection"] = connection
    return config


def history_index_exists(connection):
    if connection.dialect.name == "postgresql":
        return bool(connection.scalar(sa.text("SELECT count(*) FROM pg_indexes WHERE schemaname=current_schema() AND indexname='ix_fi_history_order'")))
    return bool(connection.scalar(sa.text("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='ix_fi_history_order'")))


def legacy_fixture(connection, tmp_path):
    config = configuration(connection)
    command.upgrade(config, "head")
    stamp = datetime(2026, 9, 1, tzinfo=timezone.utc)
    file = tmp_path / "legacy-file.xlsx"
    file.write_bytes(b"synthetic immutable file fixture")
    with Session(bind=connection) as db:
        db.add(User(id="legacy-managed", display_name="Managed Name", full_name="Managed Full Name", password_hash=hash_password("SyntheticManaged123"), role="Staff", team="TBDL", is_active=False, must_change_password=True))
        for identifier, status in [("legacy-locked", "locked"), ("legacy-draft", "draft")]:
            db.add(TeamReportModel(id=identifier, team="TBCH", report_month=9, report_year=2026, file_name=file.name, file_path=str(file), file_hash=sha256(file.read_bytes()).hexdigest(), version=7, is_current_version=True, uploaded_by="legacy-managed", uploaded_at=stamp, report_status=status, source_type="web_input", assessments=[{"notes": "Keep edited notes", "workshop_kr_code": "O1.KR1"}], team_level={"monthly_assessment": "Hoàn thành nhiệm vụ"}))
        db.add(SKCTKTModel(id="legacy-fi", sk_code="FI/09/2026-TBCH-77", title="Managed FI", author_name="Managed Name", author_user_id="legacy-managed", team="TBCH", content_description="Keep FI content", completion_plan="T9/2026", status="Approved", consider_for_khmt=True, khmt_month=9, khmt_year=2026, status_history=[{"comments": {"unchanged": True}}], created_at=stamp))
        db.add(SKImageModel(id="legacy-image", sk_ctkt_id="legacy-fi", file_name=file.name, file_path=str(file), file_size=file.stat().st_size, uploaded_by="legacy-managed"))
        db.add(NotificationModel(id="legacy-notice", recipient_role="Staff", event="LEGACY", payload={"source": "synthetic"}, read=True))
        db.add(FIMonthlyAllocationModel(id="legacy-allocation", team="TBCH", month=9, year=2026, assessment="Hoàn thành nhiệm vụ", required_count=1, allocated_count=1, available_count=1, selected_sk_ids=["legacy-fi"], released_sk_ids=[], report_id="legacy-locked", report_version=7, status="finalized", finalized_by="legacy-managed", finalized_at=stamp))
        db.commit()
    connection.commit()
    # Materialize pre-remediation columns; 0001 uses live Base metadata, so
    # upgrading only to 0011 would otherwise accidentally keep the new schema.
    command.downgrade(config, "0011_fi_monthly_allocations")
    connection.commit()
    assert not history_index_exists(connection)
    assert "revision" not in {column["name"] for column in sa.inspect(connection).get_columns("team_reports")}
    assert "notification_receipts" not in sa.inspect(connection).get_table_names()
    return config, file


def snapshot(connection, columns=None):
    metadata = sa.MetaData()
    metadata.reflect(connection)
    names = ["users", "team_reports", "sk_ctkt", "sk_images", "notifications", "fi_monthly_allocations"]
    columns = columns or {name: list(metadata.tables[name].columns.keys()) for name in names}
    records = {name: [dict(row) for row in connection.execute(sa.select(*[metadata.tables[name].c[col] for col in columns[name]]).order_by(metadata.tables[name].c.id)).mappings()] for name in names}
    return sha256(json.dumps(records, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest(), columns


def test_upgrade_preserves_legacy_data_and_old_column_reads(migration_connection, tmp_path):
    connection = migration_connection
    config, file = legacy_fixture(connection, tmp_path)
    before, columns = snapshot(connection)
    file_hash = sha256(file.read_bytes()).hexdigest()
    connection.commit()
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    assert history_index_exists(connection)
    assert snapshot(connection, columns)[0] == before
    assert sha256(file.read_bytes()).hexdigest() == file_hash
    assert connection.scalar(sa.text("SELECT session_version FROM users WHERE id='legacy-managed'")) == 1
    assert connection.scalar(sa.text("SELECT COUNT(*) FROM notification_receipts")) == 0
    assert connection.scalar(sa.text("SELECT COUNT(*) FROM team_reports WHERE is_current_version=true")) == 2
    assert verify_password("SyntheticManaged123", connection.scalar(sa.text("SELECT password_hash FROM users WHERE id='legacy-managed'")))
    # This proves old-column read compatibility, not execution of an old app image.
    assert connection.scalar(sa.text("SELECT report_status FROM team_reports WHERE id='legacy-locked'")) == "locked"


def test_upgrade_stops_on_wrong_finalized_allocation_without_repair(migration_connection, tmp_path):
    connection = migration_connection
    config, file = legacy_fixture(connection, tmp_path)
    connection.execute(sa.text("UPDATE fi_monthly_allocations SET report_version=99 WHERE id='legacy-allocation'"))
    connection.commit()
    before, columns = snapshot(connection)
    connection.commit()
    with pytest.raises(RuntimeError, match="allocation/report conflicts"):
        command.upgrade(config, "head")
    connection.rollback()
    assert snapshot(connection, columns)[0] == before
    assert file.read_bytes() == b"synthetic immutable file fixture"
