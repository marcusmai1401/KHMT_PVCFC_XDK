import importlib.util
from pathlib import Path
import pytest
from sqlalchemy import create_engine, text
from alembic.migration import MigrationContext
from alembic.operations import Operations

FILE = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0017_report_current_lanes.py"
spec = importlib.util.spec_from_file_location("lane_migration", FILE)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

@pytest.mark.parametrize("duplicate", [False, True])
def test_legacy_migration_preserves_rows_and_refuses_duplicate_lanes(tmp_path, monkeypatch, duplicate):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.sqlite3'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE team_reports (id TEXT PRIMARY KEY, team TEXT, report_month INTEGER, report_year INTEGER, report_status TEXT, is_current_version BOOLEAN, payload TEXT)"))
        connection.execute(text("INSERT INTO team_reports VALUES ('old','TBCH',9,2026,'draft',true,'kept')"))
        status = "draft" if duplicate else "submitted"
        connection.execute(text("INSERT INTO team_reports VALUES ('other','TBCH',9,2026,:status,true,'also kept')"), {"status": status})
        before = connection.execute(text("SELECT * FROM team_reports ORDER BY id")).all()
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        if duplicate:
            with pytest.raises(RuntimeError, match="lane conflicts"): migration.upgrade()
        else:
            migration.upgrade()
            migration.upgrade()
        assert connection.execute(text("SELECT * FROM team_reports ORDER BY id")).all() == before
    engine.dispose()
