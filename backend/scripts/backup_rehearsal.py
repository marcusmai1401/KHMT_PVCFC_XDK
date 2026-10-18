"""Synthetic-only backup and restore rehearsal for the local OKR data shape.

This command deliberately refuses the workspace's normal storage/database
paths.  It is an evidence tool for an isolated fixture, not a production
backup job.  Production scheduling, off-site storage, encryption, retention,
and credentials remain deployment decisions owned by the product team.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from typing import Any
from uuid import uuid4


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_DATABASE = (WORKSPACE_ROOT / "storage" / "okr_automation.db").resolve()
PRODUCTION_STORAGE = (WORKSPACE_ROOT / "storage").resolve()


def _resolve_isolated(path: Path, *, label: str, allow_missing: bool = False) -> Path:
    resolved = path.resolve()
    if resolved in {WORKSPACE_ROOT, PRODUCTION_DATABASE, PRODUCTION_STORAGE, WORKSPACE_ROOT / "backend" / "okr_automation.db"} or PRODUCTION_STORAGE in resolved.parents:
        raise ValueError(f"{label} must be an isolated synthetic path: {resolved}")
    if resolved == Path(resolved.anchor):
        raise ValueError(f"{label} may not be a filesystem root")
    if not allow_missing and not resolved.exists():
        raise ValueError(f"{label} does not exist: {resolved}")
    return resolved


def _manifest_child(root: Path, name: str) -> Path:
    candidate = (root / name).resolve()
    if not name or Path(name).is_absolute() or root.resolve() not in candidate.parents:
        raise ValueError("Backup manifest path escapes its root")
    return candidate


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _table_count(connection: sqlite3.Connection, table: str) -> int:
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    if not exists:
        return 0
    return int(connection.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0])


def _referenced_files(connection: sqlite3.Connection, storage: Path) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    queries = (
        ("TeamReport", "team_reports", "id", "file_path"),
        ("SKImage", "sk_images", "id", "file_path"),
    )
    for entity_type, table, id_column, path_column in queries:
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).fetchone()
        if not exists:
            continue
        for entity_id, raw_path in connection.execute(
            f"SELECT [{id_column}], [{path_column}] FROM [{table}] WHERE [{path_column}] IS NOT NULL AND [{path_column}] != ''"
        ):
            source = Path(str(raw_path)).resolve()
            try:
                relative = source.relative_to(storage)
            except ValueError:
                references.append(
                    {
                        "entity_type": entity_type,
                        "entity_id": str(entity_id),
                        "status": "unsafe_outside_storage",
                        "source_name": None,
                    }
                )
                continue
            references.append(
                {
                    "entity_type": entity_type,
                    "entity_id": str(entity_id),
                    "status": "referenced",
                    "source_name": relative.as_posix(),
                }
            )
    return references


def _counts(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        table: _table_count(connection, table)
        for table in (
            "users",
            "team_reports",
            "sk_ctkt",
            "sk_images",
            "fi_monthly_allocations",
            "historical_snapshots",
        )
    }


def create_backup(database: Path, storage: Path, output_root: Path, *, app_revision: str, schema_revision: str) -> Path:
    database = _resolve_isolated(database, label="source database")
    storage = _resolve_isolated(storage, label="source storage")
    output_root = _resolve_isolated(output_root, label="backup output", allow_missing=True)
    if not database.is_file() or not storage.is_dir():
        raise ValueError("Synthetic backup requires an existing database file and storage directory")
    output_root.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)
    snapshot = output_root / f"snapshot-{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    snapshot.mkdir()
    backup_db = snapshot / "database.sqlite3"
    with sqlite3.connect(database) as source_connection, sqlite3.connect(backup_db) as target_connection:
        source_connection.backup(target_connection)
        counts = _counts(target_connection)
        references = _referenced_files(target_connection, storage)

    copied_files: list[dict[str, Any]] = []
    files_root = snapshot / "files"
    files_root.mkdir()
    for reference in references:
        if reference["status"] != "referenced":
            continue
        relative = Path(reference["source_name"])
        source = storage / relative
        if not source.is_file():
            reference["status"] = "missing_source"
            continue
        destination = files_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied_files.append(
            {
                **reference,
                "size": destination.stat().st_size,
                "sha256": _sha256(destination),
                "backup_name": destination.relative_to(snapshot).as_posix(),
            }
        )

    ended = datetime.now(timezone.utc)
    manifest = {
        "kind": "okr-synthetic-backup",
        "created_at": started.isoformat(),
        "completed_at": ended.isoformat(),
        "duration_seconds": round((ended - started).total_seconds(), 3),
        "application_revision": app_revision,
        "schema_revision": schema_revision,
        "database": {
            "backup_name": "database.sqlite3",
            "size": backup_db.stat().st_size,
            "sha256": _sha256(backup_db),
        },
        "counts": counts,
        "references": references,
        "files": copied_files,
        "storage_location": "synthetic-local-only; offsite destination is pending product decision",
        "retention": "proposed: 7 daily, 4 weekly, 3 monthly; pending confirmation",
        "restore_status": "not_verified",
    }
    (snapshot / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot


def restore_backup(backup_dir: Path, restore_root: Path) -> dict[str, Any]:
    backup_dir = _resolve_isolated(backup_dir, label="backup directory")
    restore_root = _resolve_isolated(restore_root, label="restore destination", allow_missing=True)
    manifest_path = backup_dir / "manifest.json"
    if not manifest_path.is_file():
        raise ValueError("Backup manifest is missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("kind") != "okr-synthetic-backup":
        raise ValueError("Unsupported backup manifest")
    if restore_root.exists():
        raise ValueError(f"Restore destination already exists; refusing to overwrite: {restore_root}")
    source_database = _manifest_child(backup_dir, manifest["database"]["backup_name"])
    for entry in manifest.get("files", []):
        _manifest_child(backup_dir, entry["backup_name"])
        _manifest_child(restore_root / "storage", entry["source_name"])
    for source in (backup_dir / "files").rglob("*"):
        if source.is_symlink() or (backup_dir / "files").resolve() not in source.resolve().parents:
            raise ValueError("Backup files contain an unsafe link")
    restore_root.mkdir(parents=True)
    database = restore_root / "database.sqlite3"
    storage = restore_root / "storage"
    shutil.copy2(source_database, database)
    shutil.copytree(backup_dir / "files", storage, dirs_exist_ok=True)

    if _sha256(database) != manifest["database"]["sha256"]:
        raise ValueError("Restored database checksum does not match manifest")
    verified_files = 0
    missing_files: list[str] = []
    with sqlite3.connect(database) as connection:
        counts = _counts(connection)
        for file_entry in manifest.get("files", []):
            restored = storage / file_entry["source_name"]
            if not restored.is_file():
                missing_files.append(file_entry["source_name"])
                continue
            if _sha256(restored) != file_entry["sha256"]:
                raise ValueError(f"Restored file checksum does not match: {file_entry['source_name']}")
            verified_files += 1
        # The restored artifact remains self-contained: rewrite only the
        # copied database's absolute file references to the new storage root.
        for table, id_column, path_column, entity_type in (
            ("team_reports", "id", "file_path", "TeamReport"),
            ("sk_images", "id", "file_path", "SKImage"),
        ):
            exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
            ).fetchone()
            if not exists:
                continue
            for entity_id, raw_path in connection.execute(
                f"SELECT [{id_column}], [{path_column}] FROM [{table}] WHERE [{path_column}] IS NOT NULL AND [{path_column}] != ''"
            ).fetchall():
                source = Path(str(raw_path)).resolve()
                try:
                    relative = source.relative_to(Path(manifest.get("source_storage", storage)))
                except ValueError:
                    # Backups created by this script always record relative
                    # file names; use the manifest entry as the authoritative
                    # reference when the legacy absolute path is unavailable.
                    match = next(
                        (entry for entry in manifest.get("files", []) if entry["entity_type"] == entity_type and entry["entity_id"] == str(entity_id)),
                        None,
                    )
                    if match is None:
                        continue
                    relative = Path(match["source_name"])
                connection.execute(
                    f"UPDATE [{table}] SET [{path_column}] = ? WHERE [{id_column}] = ?",
                    (str(storage / relative), entity_id),
                )
        connection.commit()

    verification = {
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "restore_destination": str(restore_root),
        "database_counts_match": counts == manifest.get("counts", {}),
        "file_count_verified": verified_files,
        "missing_files": missing_files,
        "unresolved_references": [
            {
                "entity_type": entry.get("entity_type"),
                "entity_id": entry.get("entity_id"),
                "status": entry.get("status"),
            }
            for entry in manifest.get("references", [])
            if entry.get("status") != "referenced"
        ],
        "relationships_preserved": not missing_files and not any(
            entry.get("status") != "referenced" for entry in manifest.get("references", [])
        ),
        "login_smoke": "pending: provide a synthetic test credential in the application harness",
        "status": "passed"
        if counts == manifest.get("counts", {})
        and not missing_files
        and not any(entry.get("status") != "referenced" for entry in manifest.get("references", []))
        else "failed",
    }
    (restore_root / "restore-verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding="utf-8")
    return verification


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    backup = subparsers.add_parser("backup")
    backup.add_argument("--database", type=Path, required=True)
    backup.add_argument("--storage", type=Path, required=True)
    backup.add_argument("--output-root", type=Path, required=True)
    backup.add_argument("--app-revision", required=True)
    backup.add_argument("--schema-revision", required=True)
    restore = subparsers.add_parser("restore")
    restore.add_argument("--backup-dir", type=Path, required=True)
    restore.add_argument("--restore-root", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "backup":
        result = create_backup(
            args.database,
            args.storage,
            args.output_root,
            app_revision=args.app_revision,
            schema_revision=args.schema_revision,
        )
        print(json.dumps({"backup_dir": str(result), "status": "created"}, ensure_ascii=False))
        return 0
    result = restore_backup(args.backup_dir, args.restore_root)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
