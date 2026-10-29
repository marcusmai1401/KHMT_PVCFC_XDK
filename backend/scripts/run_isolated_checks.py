"""Run backend checks against an isolated synthetic SQLite database and storage tree.

This harness is intentionally conservative: it refuses production paths, supplies
fake test secrets, disables outbound LLM use, and leaves an evidence manifest next
to the captured pytest output. It is the default entry point for audit verification.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import socket
import atexit
from uuid import uuid4


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_DB = (WORKSPACE_ROOT / "backend" / "okr_automation.db").resolve()
PRODUCTION_STORAGE = (WORKSPACE_ROOT / "storage").resolve()


def _assert_isolated(path: Path, *, label: str) -> Path:
    resolved = path.resolve()
    if resolved == WORKSPACE_ROOT or resolved == PRODUCTION_DB or resolved == PRODUCTION_STORAGE:
        raise ValueError(f"{label} must be an isolated child path, not a production path: {resolved}")
    try:
        resolved.relative_to(PRODUCTION_STORAGE)
    except ValueError:
        pass
    else:
        raise ValueError(f"{label} may not be inside production storage: {resolved}")
    if resolved == Path(resolved.anchor):
        raise ValueError(f"{label} may not be a filesystem root")
    return resolved


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=WORKSPACE_ROOT / "output" / "remediation-verification",
        help="Directory for evidence manifests and captured test output",
    )
    parser.add_argument("--migrate", action="store_true", help="Rehearse Alembic upgrade on a fresh isolated database")
    parser.add_argument("--suite", choices=["sqlite", "postgres-ci", "postgres-local"], default="sqlite")
    parser.add_argument("--postgres-bin", type=Path, help="Portable PostgreSQL binaries; creates a new isolated cluster per run")
    parser.add_argument(
        "pytest_args",
        nargs=argparse.REMAINDER,
        help="Optional pytest arguments after --, for example -- tests/unit/test_security.py",
    )
    args = parser.parse_args(argv)
    if args.migrate and any(argument != "--" for argument in args.pytest_args):
        parser.error("--migrate runs Alembic only; run pytest arguments in a separate invocation without --migrate")

    output_root = _assert_isolated(args.output_dir, label="output directory")
    production_db_before = (
        (PRODUCTION_DB.stat().st_size, PRODUCTION_DB.stat().st_mtime_ns) if PRODUCTION_DB.exists() else None
    )
    run_dir = output_root / f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}"
    run_dir.mkdir(parents=True, exist_ok=False)
    database_path = _assert_isolated(run_dir / "sandbox.sqlite3", label="database path")
    storage_path = _assert_isolated(run_dir / "storage", label="storage path")
    storage_path.mkdir(parents=True, exist_ok=True)

    # Never inherit credentials, Redis endpoints, proxy settings or PYTHONPATH.
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT", "SYSTEMDRIVE"}}
    env.update(
        {
            "OKR_ENVIRONMENT": "development",
            "OKR_DATABASE_URL": f"sqlite:///{database_path.as_posix()}",
            "OKR_STORAGE_DIR": str(storage_path),
            "OKR_WORKSPACE_DIR": str(WORKSPACE_ROOT),
            "OKR_BOOTSTRAP_ADMIN_ID": "admin",
            "OKR_BOOTSTRAP_ADMIN_PASSWORD": "admin-pass",
            "OKR_BOOTSTRAP_ADMIN_NAME": "Test Admin",
            "OKR_JWT_SECRET": f"audit-test-secret-{uuid4().hex}-not-production",
            "OKR_LLM_ENABLED": "false",
            "OKR_FI_COMPLETION_SCHEDULE_SECONDS": "0",
            "OKR_REDIS_URL": "",
            "PYTHONPATH": str(WORKSPACE_ROOT / "backend"),
            "OKR_TEST_MANIFEST": str(run_dir / "test-environment.json"),
        }
    )
    postgres_database = None
    postgres_port = 5432
    if args.suite == "postgres-local":
        if args.postgres_bin is None:
            raise ValueError("--postgres-bin is required for postgres-local")
        binaries = args.postgres_bin.resolve()
        cluster = run_dir / "postgres-data"
        hidden = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        subprocess.run([str(binaries / "initdb"), "-D", str(cluster), "-U", "okr", "--auth=trust", "--encoding=UTF8", "--locale=C"], check=True, capture_output=True, **hidden)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            postgres_port = sock.getsockname()[1]
        control = str(binaries / "pg_ctl")
        subprocess.run([control, "-D", str(cluster), "-l", str(run_dir / "postgres.log"), "-o", f"-h 127.0.0.1 -p {postgres_port}", "-w", "start"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **hidden)
        atexit.register(lambda: subprocess.run([control, "-D", str(cluster), "-m", "fast", "-w", "stop"], capture_output=True, **hidden))
        import psycopg
        from psycopg import sql
        postgres_database = "okr_audit_" + uuid4().hex
        with psycopg.connect(host="127.0.0.1", port=postgres_port, dbname="postgres", user="okr", autocommit=True) as connection:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(postgres_database)))
        env["OKR_DATABASE_URL"] = f"postgresql+psycopg://okr:ci-only-password@127.0.0.1:{postgres_port}/{postgres_database}"
        env["OKR_TEST_POSTGRES_LOCAL"] = "true"
    if args.suite == "postgres-ci":
        if os.environ.get("GITHUB_ACTIONS") != "true":
            raise ValueError("postgres-ci requires the ephemeral PostgreSQL service in GitHub Actions")
        import psycopg
        from psycopg import sql
        postgres_database = "okr_audit_" + uuid4().hex
        # Fixed synthetic CI service, never a caller-supplied business URL.
        with psycopg.connect(host="127.0.0.1", port=5432, dbname="okr_automation_test", user="okr", password="ci-only-password", autocommit=True) as connection:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(postgres_database)))
        env["OKR_DATABASE_URL"] = f"postgresql+psycopg://okr:ci-only-password@127.0.0.1:5432/{postgres_database}"
        env["OKR_TEST_POSTGRES_CI"] = "true"
    (run_dir / "test-environment.json").write_text(json.dumps({
        "run_dir": str(run_dir.resolve()), "database_path": str(database_path),
        "storage_path": str(storage_path), "synthetic": True,
        "postgres_database": postgres_database,
        "postgres_port": postgres_port,
        "postgres_local": args.suite == "postgres-local",
    }), encoding="utf-8")
    pytest_args = list(args.pytest_args)
    if pytest_args and pytest_args[0] == "--":
        pytest_args.pop(0)
    if not pytest_args:
        pytest_args = ["tests"]
    command = [sys.executable, "-m", "alembic", "upgrade", "head"] if args.migrate else [sys.executable, "-m", "pytest", "-q", *pytest_args]
    started = time.time()
    completed = subprocess.run(
        command,
        cwd=WORKSPACE_ROOT / "backend",
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    duration = round(time.time() - started, 3)
    (run_dir / "pytest.stdout.txt").write_text(completed.stdout, encoding="utf-8")
    (run_dir / "pytest.stderr.txt").write_text(completed.stderr, encoding="utf-8")
    manifest = {
        "harness": "backend/scripts/run_isolated_checks.py",
        "suite": args.suite,
        "postgres_database": postgres_database,
        "postgres_port": postgres_port if postgres_database else None,
        "status": "passed" if completed.returncode == 0 else "failed",
        "exit_code": completed.returncode,
        "duration_seconds": duration,
        "command": command,
        "database_path": str(database_path),
        "storage_path": str(storage_path),
        "production_db_untouched": (
            (PRODUCTION_DB.stat().st_size, PRODUCTION_DB.stat().st_mtime_ns)
            if PRODUCTION_DB.exists()
            else None
        )
        == production_db_before,
        "llm_enabled": False,
        "fake_secret": True,
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({**manifest, "run_dir": str(run_dir)}, indent=2))
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
