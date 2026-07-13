import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rejects_default_jwt_secret():
    with pytest.raises(ValidationError, match="OKR_JWT_SECRET"):
        Settings(_env_file=None, environment="production", jwt_secret="dev-change-me")


def test_production_accepts_strong_jwt_secret():
    settings = Settings(
        _env_file=None,
        environment="production",
        jwt_secret="production-validation-secret-32-chars-minimum",
    )

    assert settings.environment == "production"
