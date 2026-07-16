from pathlib import Path
import importlib.util
import sys
import types


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# The backend CI environment intentionally does not install the deployment-only
# SSH client. These tests exercise the pure command/workflow builders, so a
# module placeholder keeps collection independent from deploy credentials/tools.
if importlib.util.find_spec("paramiko") is None:
    sys.modules["paramiko"] = types.ModuleType("paramiko")

from deploy_prod import remote_deploy_command


def test_remote_deploy_verifies_archive_and_never_resets_existing_passwords():
    digest = "a" * 64
    command = remote_deploy_command(
        "/opt/okr-system",
        "/tmp/okr-deploy-random.tar.gz",
        digest,
        seed_users=True,
        seed_et_data=True,
    )

    assert "sha256sum -c -" in command
    assert digest in command
    assert "reset_default_password_candidates" not in command
    assert "--reset-passwords" not in command
    assert "trap 'rm -f -- /tmp/okr-deploy-random.tar.gz' EXIT" in command
    historical_import = (
        "python scripts/import_historical.py /app/KHMT_Monthly "
        "--months 5 --imported-by deploy-import"
    )
    assert historical_import in command
    assert command.index("alembic upgrade head") < command.index(historical_import)
    assert command.index(historical_import) < command.index("Checking services")


def test_workflow_is_main_only_key_based_and_fail_closed_on_host_identity():
    workflow = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")

    assert "branches:\n      - main" in workflow
    assert "github.ref == 'refs/heads/main'" in workflow
    assert "VPS_SSH_PRIVATE_KEY" in workflow
    assert "VPS_HOST_KEY:?" in workflow
    assert "VPS_PASSWORD" not in workflow
    assert "ssh-keyscan" not in workflow
    assert "persist-credentials: false" in workflow
