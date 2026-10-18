"""Provenance and conservative retention for newly generated files.

Legacy files without a manifest are never cleanup candidates. Cleanup is an
operator maintenance operation with writers paused; preview is the default.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from app.core.config import settings
from app.models.domain import TeamReportModel, SKImageModel


def register_artifact(path: Path, source: str) -> None:
    root = settings.storage_dir.resolve()
    target = path.resolve()
    if root not in target.parents or target.is_symlink():
        raise ValueError("Artifact escaped storage")
    index = root / "artifact-manifests"
    index.mkdir(parents=True, exist_ok=True)
    manifest = index / f"{uuid4().hex}.json"
    manifest.write_text(json.dumps({"version": 1, "path": target.relative_to(root).as_posix(), "source": source, "created_at": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")


def reconcile_artifacts(db, *, apply=False, writers_paused=False, min_age_hours=24, now=None):
    if min_age_hours < 24:
        raise ValueError("Artifact retention must be at least 24 hours")
    if apply and not writers_paused:
        raise ValueError("Pause writers before applying artifact cleanup")
    root = settings.storage_dir.resolve()
    referenced = set()
    for model in (TeamReportModel, SKImageModel):
        referenced.update(Path(path).resolve() for path in db.scalars(select(model.file_path)) if path)
    current = now or datetime.now(timezone.utc)
    results = []
    for manifest in sorted((root / "artifact-manifests").glob("*.json")):
        try:
            if manifest.is_symlink():
                raise ValueError("Linked manifest")
            entry = json.loads(manifest.read_text(encoding="utf-8"))
            relative = Path(entry["path"])
            path = (root / relative).resolve()
            created = datetime.fromisoformat(entry["created_at"])
            if entry.get("version") != 1 or not entry.get("source") or relative.is_absolute() or root not in path.parents or (root / relative).is_symlink():
                raise ValueError("Invalid artifact provenance")
            if path in referenced:
                status = "referenced"
            elif (current - created).total_seconds() < min_age_hours * 3600:
                status = "retained_recent"
            elif path.exists() and (current.timestamp() - path.stat().st_mtime) < min_age_hours * 3600:
                status = "retained_recent"
            else:
                status = "orphan" if path.exists() else "missing"
                if apply:
                    path.unlink(missing_ok=True)
                    manifest.unlink()
                    status = "removed" if status == "orphan" else "removed_stale_manifest"
            results.append({"manifest": manifest.name, "status": status, "source": entry["source"]})
        except (ValueError, KeyError, TypeError, OSError) as error:
            results.append({"manifest": manifest.name, "status": "invalid_manifest", "error_type": type(error).__name__})
    return {"apply": apply, "min_age_hours": min_age_hours, "items": results}
