from __future__ import annotations

import argparse
import fnmatch
import getpass
import os
from pathlib import Path
import posixpath
import shlex
import sys
import tarfile
import tempfile
import time

import paramiko


DEFAULT_HOST = "103.200.20.225"
DEFAULT_PORT = 22
DEFAULT_USER = "root"
DEFAULT_REMOTE_DIR = "/opt/okr-system"
BM01_ROOT_FILE = "BM 01 Dang ky - Danh gia SK.xlsx"
BM01_APP_FILE = "FI xlsx/BM 01 Dang ky - Danh gia SK _Rev1.xlsx"
BM01_SHEETS = ("TBCH", "TBĐ", "TBHTĐK", "TC- ĐK")

EXCLUDE_DIRS = {
    ".git",
    ".codex",
    ".kiro",
    ".hypothesis",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "dist",
    "htmlcov",
    "node_modules",
    "venv",
}
EXCLUDE_FILES = {
    ".env",
    ".env.production",
    BM01_ROOT_FILE,
}
EXCLUDE_GLOBS = (
    "*.db",
    "*.log",
    "*.pyc",
    "*.tsbuildinfo",
    "frontend/dist/*",
    "frontend/node_modules/*",
    "storage/backups/*",
    "storage/exports/*",
    "storage/sandbox/*",
    "storage/templates/*",
    "storage/uploads/*",
)


def should_exclude(path: Path, root: Path) -> bool:
    rel = path.relative_to(root).as_posix()
    if path.is_dir() and path.name in EXCLUDE_DIRS:
        return True
    if path.is_file() and path.name in EXCLUDE_FILES:
        return True
    return any(fnmatch.fnmatch(rel, pattern) for pattern in EXCLUDE_GLOBS)


def build_archive(root: Path, archive_path: Path) -> None:
    mapped_bm01 = root / BM01_ROOT_FILE
    with tarfile.open(archive_path, "w:gz") as archive:
        for current_dir, dir_names, file_names in os.walk(root):
            current = Path(current_dir)
            dir_names[:] = [
                name
                for name in sorted(dir_names)
                if not should_exclude(current / name, root)
            ]
            for file_name in sorted(file_names):
                path = current / file_name
                rel = path.relative_to(root).as_posix()
                if mapped_bm01.exists() and rel == BM01_APP_FILE:
                    continue
                if should_exclude(path, root):
                    continue
                archive.add(path, arcname=rel)
        if mapped_bm01.exists():
            archive.add(mapped_bm01, arcname=BM01_APP_FILE)


def connect(host: str, port: int, user: str, password: str, *, accept_new_host_key: bool = False) -> paramiko.SSHClient:
    ssh = paramiko.SSHClient()
    ssh.load_system_host_keys()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy() if accept_new_host_key else paramiko.RejectPolicy())
    ssh.connect(hostname=host, port=port, username=user, password=password, timeout=30)
    return ssh


def upload(ssh: paramiko.SSHClient, local_path: Path, remote_path: str) -> None:
    sftp = ssh.open_sftp()
    try:
        sftp.put(str(local_path), remote_path)
    finally:
        sftp.close()


def run(ssh: paramiko.SSHClient, command: str) -> None:
    stdin, stdout, stderr = ssh.exec_command(f"bash -lc {shlex.quote(command)}")
    del stdin
    channel = stdout.channel
    while not channel.exit_status_ready():
        if channel.recv_ready():
            sys.stdout.write(channel.recv(4096).decode("utf-8", errors="replace"))
            sys.stdout.flush()
        if channel.recv_stderr_ready():
            sys.stderr.write(channel.recv_stderr(4096).decode("utf-8", errors="replace"))
            sys.stderr.flush()
        time.sleep(0.1)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        sys.stdout.write(out)
    if err:
        sys.stderr.write(err)
    status = channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(f"Remote command failed with exit code {status}")


def remote_deploy_command(
    remote_dir: str,
    remote_archive: str,
    skip_import_bm01: bool,
    seed_users: bool,
    reset_user_passwords: bool,
    seed_et_data: bool,
) -> str:
    compose = "docker compose --env-file .env.production -f docker-compose.prod.yml"
    import_commands = []
    if not skip_import_bm01:
        workbook = "/app/" + BM01_APP_FILE
        source_label = "/app/" + BM01_APP_FILE
        for sheet in BM01_SHEETS:
            import_commands.append(
                f"{compose} exec -T backend python scripts/import_bm01_legacy_sheet.py "
                f"{shlex.quote(workbook)} --sheet {shlex.quote(sheet)} --year 2026 "
                f"--source-label {shlex.quote(source_label)} --imported-by deploy-import"
            )
    import_block = "\n".join(import_commands) if import_commands else "true"

    if seed_users:
        reset_flag = " --reset-passwords" if reset_user_passwords else ""
        seed_block = f"echo \"Seeding 56 user accounts for Xưởng Điều khiển\"\n{compose} exec -T backend python scripts/seed_users_xuong_dk.py{reset_flag}"
    else:
        seed_block = "true"
    if seed_et_data:
        et_seed_block = "\n".join(
            [
                f"{compose} exec -T backend python scripts/seed_pvcfc_knl.py",
                f"{compose} exec -T backend python scripts/seed_et_personnel.py",
            ]
        )
    else:
        et_seed_block = "true"
    return f"""
set -euo pipefail
mkdir -p {shlex.quote(remote_dir)} /backup/okr
cd {shlex.quote(remote_dir)}
if [ ! -f .env.production ]; then
  echo ".env.production is missing on {remote_dir}" >&2
  exit 2
fi
stamp=$(date +%Y%m%d%H%M%S)
POSTGRES_USER_VALUE=$(grep -E '^POSTGRES_USER=' .env.production | tail -n 1 | cut -d= -f2- || true)
POSTGRES_DB_VALUE=$(grep -E '^POSTGRES_DB=' .env.production | tail -n 1 | cut -d= -f2- || true)
POSTGRES_USER_VALUE=${{POSTGRES_USER_VALUE:-okr}}
POSTGRES_DB_VALUE=${{POSTGRES_DB_VALUE:-okr_automation}}
if {compose} ps postgres >/dev/null 2>&1; then
  echo "Backing up PostgreSQL to /backup/okr/okr_${{stamp}}.sql.gz"
  {compose} exec -T postgres pg_dump -U "${{POSTGRES_USER_VALUE}}" "${{POSTGRES_DB_VALUE}}" | gzip > "/backup/okr/okr_${{stamp}}.sql.gz"
fi
if [ -d storage ]; then
  echo "Backing up storage to /backup/okr/storage_${{stamp}}.tar.gz"
  tar -czf "/backup/okr/storage_${{stamp}}.tar.gz" storage
fi
echo "Cleaning old source files"
find . -mindepth 1 -maxdepth 1 ! -name '.env.production' ! -name 'storage' -exec rm -rf -- {{}} +
echo "Extracting source archive"
tar -xzf {shlex.quote(remote_archive)} -C {shlex.quote(remote_dir)}
rm -f {shlex.quote(remote_archive)}
mkdir -p storage/uploads storage/exports storage/templates storage/backups
echo "Rebuilding containers"
{compose} up -d --build
echo "Running migrations"
{compose} exec -T backend alembic upgrade head
echo "Seeding user accounts"
{seed_block}
echo "Seeding ET competency frameworks and personnel"
{et_seed_block}
echo "Importing BM01 legacy rows"
{import_block}
echo "Checking services"
{compose} ps
curl -fsS http://127.0.0.1/health
echo
echo "Deploy complete"
"""


def main() -> int:
    if os.getenv("GITHUB_ACTIONS") != "true":
        raise SystemExit(
            "Direct VPS deploy is disabled. Use GitHub Actions via "
            "`./deploy_github_actions.sh --watch` or the Actions tab."
        )

    parser = argparse.ArgumentParser(description="Deploy OKR system to the production VPS.")
    parser.add_argument("--host", default=os.getenv("VPS_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.getenv("VPS_PORT", DEFAULT_PORT)))
    parser.add_argument("--user", default=os.getenv("VPS_USER", DEFAULT_USER))
    parser.add_argument("--remote-dir", default=os.getenv("VPS_REMOTE_DIR", DEFAULT_REMOTE_DIR))
    parser.add_argument("--skip-import-bm01", action="store_true")
    parser.add_argument(
        "--skip-user-seed",
        action="store_true",
        help="Bỏ qua bước chạy scripts/seed_users_xuong_dk.py.",
    )
    parser.add_argument(
        "--reset-user-passwords",
        action="store_true",
        help="Khi seed user, reset password mặc định cho user đã tồn tại.",
    )
    parser.add_argument(
        "--skip-et-seed",
        action="store_true",
        help="Bỏ qua bước seed Khung năng lực và Nhân sự ET production.",
    )
    parser.add_argument(
        "--accept-new-host-key",
        action="store_true",
        default=os.getenv("VPS_ACCEPT_NEW_HOST_KEY") == "1",
        help="Trust an unknown SSH host key on first connection.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    password = os.getenv("VPS_PASSWORD") or getpass.getpass(f"Password for {args.user}@{args.host}: ")
    remote_archive = posixpath.join("/tmp", f"okr-deploy-{int(time.time())}.tar.gz")

    with tempfile.TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / "okr-deploy.tar.gz"
        print("Building deployment archive...")
        build_archive(root, archive_path)
        print(f"Archive size: {archive_path.stat().st_size / (1024 * 1024):.1f} MB")

        print(f"Connecting to {args.user}@{args.host}:{args.port}...")
        ssh = connect(args.host, args.port, args.user, password, accept_new_host_key=args.accept_new_host_key)
        try:
            print(f"Uploading archive to {remote_archive}...")
            upload(ssh, archive_path, remote_archive)
            print("Running remote deploy...")
            run(
                ssh,
                remote_deploy_command(
                    args.remote_dir,
                    remote_archive,
                    args.skip_import_bm01,
                    seed_users=not args.skip_user_seed,
                    reset_user_passwords=args.reset_user_passwords,
                    seed_et_data=not args.skip_et_seed,
                ),
            )
        finally:
            ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
