import json
import sqlite3
from pathlib import Path

import pytest

from scripts.backup_rehearsal import create_backup, restore_backup


def _synthetic_database(path: Path, storage: Path) -> None:
    report_path = storage / "reports" / "báo-cáo.xlsx"
    image_path = storage / "uploads" / "ảnh.png"
    report_path.parent.mkdir(parents=True)
    image_path.parent.mkdir(parents=True)
    report_path.write_bytes(b"synthetic-report")
    image_path.write_bytes(b"synthetic-image")
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT);
            CREATE TABLE team_reports (id TEXT PRIMARY KEY, file_path TEXT);
            CREATE TABLE sk_ctkt (id TEXT PRIMARY KEY);
            CREATE TABLE sk_images (id TEXT PRIMARY KEY, file_path TEXT);
            CREATE TABLE fi_monthly_allocations (id TEXT PRIMARY KEY);
            CREATE TABLE historical_snapshots (id TEXT PRIMARY KEY);
            """
        )
        connection.execute("INSERT INTO users VALUES ('test-user', 'hash')")
        connection.execute("INSERT INTO team_reports VALUES (?, ?)", ("report-1", str(report_path)))
        connection.execute("INSERT INTO sk_ctkt VALUES ('fi-1')")
        connection.execute("INSERT INTO sk_images VALUES (?, ?)", ("image-1", str(image_path)))
        connection.execute("INSERT INTO fi_monthly_allocations VALUES ('allocation-1')")
        connection.commit()


def test_backup_restore_rehearsal_preserves_counts_checksums_and_new_paths(tmp_path):
    source_db = tmp_path / "source" / "database.sqlite3"
    source_storage = tmp_path / "source" / "storage"
    source_db.parent.mkdir()
    source_storage.mkdir()
    _synthetic_database(source_db, source_storage)

    backup_dir = create_backup(
        source_db,
        source_storage,
        tmp_path / "backups",
        app_revision="synthetic-app",
        schema_revision="0015_user_feedback",
    )
    manifest = json.loads((backup_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["restore_status"] == "not_verified"
    assert manifest["database"]["sha256"]
    assert len(manifest["files"]) == 2

    verification = restore_backup(backup_dir, tmp_path / "restore")
    assert verification["status"] == "passed"
    assert verification["database_counts_match"] is True
    assert verification["relationships_preserved"] is True

    with sqlite3.connect(tmp_path / "restore" / "database.sqlite3") as connection:
        restored_path = connection.execute("SELECT file_path FROM team_reports WHERE id = 'report-1'").fetchone()[0]
    assert str(tmp_path / "restore" / "storage") in restored_path
    assert (tmp_path / "restore" / "storage" / "reports" / "báo-cáo.xlsx").read_bytes() == b"synthetic-report"


def test_restore_reports_missing_referenced_file_and_does_not_overwrite(tmp_path):
    source_db = tmp_path / "source" / "database.sqlite3"
    source_storage = tmp_path / "source" / "storage"
    source_db.parent.mkdir()
    source_storage.mkdir()
    _synthetic_database(source_db, source_storage)
    backup_dir = create_backup(source_db, source_storage, tmp_path / "backups", app_revision="app", schema_revision="schema")

    manifest = json.loads((backup_dir / "manifest.json").read_text(encoding="utf-8"))
    (backup_dir / manifest["files"][0]["backup_name"]).unlink()
    verification = restore_backup(backup_dir, tmp_path / "restore")
    assert verification["status"] == "failed"
    assert verification["missing_files"]

    with pytest.raises(ValueError, match="already exists"):
        restore_backup(backup_dir, tmp_path / "restore")


def test_restore_rejects_manifest_traversal_before_creating_destination(tmp_path):
    source_db = tmp_path / "source" / "database.sqlite3"
    source_storage = tmp_path / "source" / "storage"
    source_db.parent.mkdir()
    source_storage.mkdir()
    _synthetic_database(source_db, source_storage)
    backup_dir = create_backup(source_db, source_storage, tmp_path / "backups", app_revision="app", schema_revision="schema")
    manifest_path = backup_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"][0]["source_name"] = "../../outside.xlsx"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="escapes"):
        restore_backup(backup_dir, tmp_path / "restore")
    assert not (tmp_path / "restore").exists()
