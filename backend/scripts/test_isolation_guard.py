"""Standalone negative checks: deliberately avoid importing the application."""
import ast
import json
import os
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from unittest.mock import patch

CONFTEXT = Path(__file__).resolve().parents[1] / "tests" / "conftest.py"
module = ast.parse(CONFTEXT.read_text(encoding="utf-8"))
function = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "validate_test_environment")
scope = {"os": os, "Path": Path, "json": json, "__file__": str(CONFTEXT)}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(CONFTEXT), "exec"), scope)
validate = scope["validate_test_environment"]

class IsolationChecks(unittest.TestCase):
    def test_migration_mode_does_not_silently_ignore_tests(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("run_isolated_checks.py")), "--migrate", "--", "tests/unit/test_security.py"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("runs Alembic only", result.stderr)

    def test_missing_manifest_rejected(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(RuntimeError):
            validate()

    def test_external_database_or_storage_rejected(self):
        with tempfile.TemporaryDirectory(prefix="okr-isolation-negative-") as temp:
            root = Path(temp).resolve()
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"run_dir": str(root), "database_path": str(root / "sandbox.sqlite3"), "storage_path": str(root / "storage"), "synthetic": True}))
            env = {"OKR_TEST_MANIFEST": str(manifest), "OKR_DATABASE_URL": f"sqlite:///{(root / 'sandbox.sqlite3').as_posix()}", "OKR_STORAGE_DIR": str(root / "storage"), "OKR_LLM_ENABLED": "false", "OKR_REDIS_URL": ""}
            with patch.dict(os.environ, env, clear=True):
                validate()
                for key, value in [("OKR_DATABASE_URL", "postgresql://outside/real"), ("OKR_STORAGE_DIR", str(root.parent)), ("OKR_REDIS_URL", "redis://outside"), ("OKR_LLM_ENABLED", "true")]:
                    with patch.dict(os.environ, {key: value}), self.assertRaises(RuntimeError):
                        validate()

if __name__ == "__main__":
    unittest.main()
