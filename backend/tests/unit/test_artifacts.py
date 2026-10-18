from datetime import datetime, timedelta, timezone
import json
import pytest

from app.core.config import settings
from app.services.artifacts import register_artifact, reconcile_artifacts
from tests.unit.test_fi_monthly_allocation import _report


def test_cleanup_preserves_references_recent_files_and_legacy(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", tmp_path)
    old = datetime.now(timezone.utc) - timedelta(days=2)
    paths = {name: tmp_path / name for name in ["referenced.xlsx", "orphan.xlsx", "recent.xlsx", "legacy.xlsx"]}
    for path in paths.values():
        path.write_bytes(b"synthetic")
    for name in ["referenced.xlsx", "orphan.xlsx", "recent.xlsx"]:
        register_artifact(paths[name], "synthetic-test")
    import os
    for name in ["referenced.xlsx", "orphan.xlsx"]:
        os.utime(paths[name], (old.timestamp(), old.timestamp()))
    for manifest in (tmp_path / "artifact-manifests").glob("*.json"):
        entry = json.loads(manifest.read_text())
        if entry["path"] != "recent.xlsx":
            entry["created_at"] = old.isoformat()
            manifest.write_text(json.dumps(entry))
    report = _report()
    report.file_path = str(paths["referenced.xlsx"])
    db_session.add(report)
    db_session.commit()
    preview = reconcile_artifacts(db_session)
    assert {row["status"] for row in preview["items"]} == {"referenced", "orphan", "retained_recent"}
    assert all(path.exists() for path in paths.values())
    with pytest.raises(ValueError, match="Pause writers"):
        reconcile_artifacts(db_session, apply=True)
    applied = reconcile_artifacts(db_session, apply=True, writers_paused=True)
    assert sum(row["status"] == "removed" for row in applied["items"]) == 1
    assert not paths["orphan.xlsx"].exists()
    assert all(paths[name].exists() for name in ["referenced.xlsx", "recent.xlsx", "legacy.xlsx"])


def test_cleanup_rejects_paths_outside_storage(db_session, tmp_path, monkeypatch):
    root = tmp_path / "storage"
    root.mkdir()
    monkeypatch.setattr(settings, "storage_dir", root)
    outside = tmp_path / "keep.txt"
    outside.write_text("synthetic")
    with pytest.raises(ValueError, match="escaped"):
        register_artifact(outside, "synthetic-test")
    index = root / "artifact-manifests"
    index.mkdir()
    (index / "invalid.json").write_text(json.dumps({"version": 1, "source": "test", "path": "../keep.txt", "created_at": "2020-01-01T00:00:00+00:00"}))
    result = reconcile_artifacts(db_session, apply=True, writers_paused=True)
    assert result["items"][0]["status"] == "invalid_manifest"
    assert outside.read_text() == "synthetic"
