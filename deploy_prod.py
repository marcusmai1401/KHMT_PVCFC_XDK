from __future__ import annotations

import argparse
import fnmatch
import hashlib
import os
from pathlib import Path
import posixpath
import secrets
import shlex
import sys
import tarfile
import tempfile
import time

import paramiko


DEFAULT_PORT = 22
DEFAULT_REMOTE_DIR = "/opt/okr-system"

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
                if should_exclude(path, root):
                    continue
                rel = path.relative_to(root).as_posix()
                archive.add(path, arcname=rel)


def connect(
    host: str,
    port: int,
    user: str,
    *,
    key_path: Path,
    known_hosts_path: Path,
    key_passphrase: str | None = None,
) -> paramiko.SSHClient:
    ssh = paramiko.SSHClient()
    ssh.load_system_host_keys()
    ssh.load_host_keys(str(known_hosts_path))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect(
        hostname=host,
        port=port,
        username=user,
        key_filename=str(key_path),
        passphrase=key_passphrase,
        allow_agent=False,
        look_for_keys=False,
        timeout=30,
        banner_timeout=30,
        auth_timeout=30,
    )
    return ssh


def upload(ssh: paramiko.SSHClient, local_path: Path, remote_path: str) -> None:
    sftp = ssh.open_sftp()
    try:
        sftp.put(str(local_path), remote_path)
        sftp.chmod(remote_path, 0o600)
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
    archive_sha256: str,
    seed_users: bool,
    seed_et_data: bool,
) -> str:
    compose = "docker compose --env-file .env.production -f docker-compose.prod.yml"
    if seed_users:
        seed_block = f"echo \"Seeding 56 user accounts for Xưởng Điều khiển\"\n{compose} exec -T backend python scripts/seed_users_xuong_dk.py"
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
log() {{ printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }}
trap 'rm -f -- {shlex.quote(remote_archive)}' EXIT
mkdir -p {shlex.quote(remote_dir)} /backup/okr
cd {shlex.quote(remote_dir)}
if [ ! -f .env.production ]; then
  echo ".env.production is missing on {remote_dir}" >&2
  exit 2
fi
if ! grep -qE '^OKR_ENVIRONMENT=production\\s*$' .env.production; then
  echo "OKR_ENVIRONMENT=production is missing from .env.production on {remote_dir} -- refusing to deploy." >&2
  echo "Without it, dev-only shortcuts (e.g. the sandbox default-password login) default to enabled. Add the line and re-run." >&2
  exit 3
fi
env_value() {{ grep -E "^$1=" .env.production | tail -n 1 | cut -d= -f2- || true; }}
JWT_SECRET_VALUE=$(env_value OKR_JWT_SECRET)
POSTGRES_PASSWORD_VALUE=$(env_value POSTGRES_PASSWORD)
if [ "${{#JWT_SECRET_VALUE}}" -lt 32 ] || [ "$JWT_SECRET_VALUE" = "dev-change-me" ] || printf '%s' "$JWT_SECRET_VALUE" | grep -qi 'change-this'; then
  echo "OKR_JWT_SECRET must be a non-placeholder secret of at least 32 characters." >&2
  exit 4
fi
if [ "${{#POSTGRES_PASSWORD_VALUE}}" -lt 16 ] || printf '%s' "$POSTGRES_PASSWORD_VALUE" | grep -qi 'change-this'; then
  echo "POSTGRES_PASSWORD must be a non-placeholder secret of at least 16 characters." >&2
  exit 5
fi
log "Verifying deployment archive integrity"
printf '%s  %s\n' {shlex.quote(archive_sha256)} {shlex.quote(remote_archive)} | sha256sum -c -
stamp=$(date +%Y%m%d%H%M%S)
POSTGRES_USER_VALUE=$(grep -E '^POSTGRES_USER=' .env.production | tail -n 1 | cut -d= -f2- || true)
POSTGRES_DB_VALUE=$(grep -E '^POSTGRES_DB=' .env.production | tail -n 1 | cut -d= -f2- || true)
POSTGRES_USER_VALUE=${{POSTGRES_USER_VALUE:-okr}}
POSTGRES_DB_VALUE=${{POSTGRES_DB_VALUE:-okr_automation}}
if {compose} ps postgres >/dev/null 2>&1; then
  log "Backing up PostgreSQL"
  {compose} exec -T postgres pg_dump -U "${{POSTGRES_USER_VALUE}}" "${{POSTGRES_DB_VALUE}}" | gzip > "/backup/okr/okr_${{stamp}}.sql.gz"
fi
if [ -d storage ]; then
  log "Backing up storage"
  tar -czf "/backup/okr/storage_${{stamp}}.tar.gz" storage
fi
log "Cleaning old source files"
find . -mindepth 1 -maxdepth 1 ! -name '.env.production' ! -name 'storage' -exec rm -rf -- {{}} +
log "Extracting verified source archive"
tar -xzf {shlex.quote(remote_archive)} -C {shlex.quote(remote_dir)}
rm -f {shlex.quote(remote_archive)}
mkdir -p storage/uploads storage/exports storage/templates storage/backups
log "Rebuilding containers"
{compose} up -d --build
log "Running migrations"
{compose} exec -T backend alembic upgrade head
log "Seeding user accounts without changing existing passwords"
{seed_block}
log "Seeding ET competency frameworks and personnel"
{et_seed_block}
log "Checking services"
{compose} ps
curl -fsS http://127.0.0.1/health
echo
log "Deploy complete"
"""


def main() -> int:
    if os.getenv("GITHUB_ACTIONS") != "true":
        raise SystemExit(
            "Direct VPS deploy is disabled. Use GitHub Actions via "
            "`./deploy_github_actions.sh --watch` or the Actions tab."
        )

    parser = argparse.ArgumentParser(description="Deploy OKR system to the production VPS.")
    parser.add_argument("--host", default=os.getenv("VPS_HOST"))
    parser.add_argument("--port", type=int, default=int(os.getenv("VPS_PORT") or DEFAULT_PORT))
    parser.add_argument("--user", default=os.getenv("VPS_USER"))
    parser.add_argument("--remote-dir", default=os.getenv("VPS_REMOTE_DIR") or DEFAULT_REMOTE_DIR)
    parser.add_argument("--ssh-key", default=os.getenv("VPS_SSH_KEY_PATH"))
    parser.add_argument("--known-hosts", default=os.getenv("VPS_KNOWN_HOSTS_PATH"))
    parser.add_argument(
        "--skip-user-seed",
        action="store_true",
        help="Bỏ qua bước chạy scripts/seed_users_xuong_dk.py.",
    )
    parser.add_argument(
        "--skip-et-seed",
        action="store_true",
        help="Bỏ qua bước seed Khung năng lực và Nhân sự ET production.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    required = {
        "VPS_HOST": args.host,
        "VPS_USER": args.user,
        "VPS_SSH_KEY_PATH": args.ssh_key,
        "VPS_KNOWN_HOSTS_PATH": args.known_hosts,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise SystemExit(f"Missing required deployment configuration: {', '.join(missing)}")
    key_path = Path(args.ssh_key)
    known_hosts_path = Path(args.known_hosts)
    if not key_path.is_file() or not known_hosts_path.is_file():
        raise SystemExit("SSH key or pinned known-hosts file is missing")

    remote_archive = posixpath.join("/tmp", f"okr-deploy-{secrets.token_hex(16)}.tar.gz")

    with tempfile.TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / "okr-deploy.tar.gz"
        print("Building deployment archive...")
        build_archive(root, archive_path)
        archive_sha256 = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        print(f"Archive size: {archive_path.stat().st_size / (1024 * 1024):.1f} MB")
        print(f"Archive SHA-256: {archive_sha256}")

        print(f"Connecting to {args.user}@{args.host}:{args.port}...")
        ssh = connect(
            args.host,
            args.port,
            args.user,
            key_path=key_path,
            known_hosts_path=known_hosts_path,
            key_passphrase=os.getenv("VPS_SSH_KEY_PASSPHRASE") or None,
        )
        try:
            print(f"Uploading archive to {remote_archive}...")
            upload(ssh, archive_path, remote_archive)
            print("Running remote deploy...")
            run(
                ssh,
                remote_deploy_command(
                    args.remote_dir,
                    remote_archive,
                    archive_sha256,
                    seed_users=not args.skip_user_seed,
                    seed_et_data=not args.skip_et_seed,
                ),
            )
        finally:
            ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
