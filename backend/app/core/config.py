from functools import cached_property
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]
WORKSPACE_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    app_name: str = "OKR Automation System"
    api_prefix: str = "/api/v1"
    environment: str = "development"
    database_url: str | None = None
    jwt_secret: str = "dev-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 480
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    redis_url: str | None = None
    bootstrap_admin_id: str | None = None
    bootstrap_admin_password: str | None = None
    bootstrap_admin_name: str = "System Administrator"
    workspace_dir: Path = WORKSPACE_DIR
    storage_dir: Path = workspace_dir / "storage"
    source_okr_workbook: Path = workspace_dir / "OKR tháng 04-2026 - X.ĐK.xlsx"
    max_excel_upload_mb: int = 10
    max_image_upload_mb: int = 5
    dashboard_cache_ttl_seconds: int = 300
    llm_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "OKR_DLG_API_KEY",
            "DLG_API_KEY",
            "OKR_HOCAI_API_KEY",
            "HOCAI_API_KEY",
            "OKR_LLM_API_KEY",
            "LLM_API_KEY",
        ),
    )
    llm_base_url: str = Field(
        default="https://danglamgiau.com/v1",
        validation_alias=AliasChoices(
            "OKR_DLG_BASE_URL",
            "DLG_BASE_URL",
            "OKR_HOCAI_BASE_URL",
            "HOCAI_BASE_URL",
            "OKR_LLM_BASE_URL",
            "LLM_BASE_URL",
        ),
    )
    llm_model: str = Field(
        default="deepseek-v4-pro",
        validation_alias=AliasChoices(
            "OKR_DLG_MODEL",
            "DLG_MODEL",
            "OKR_HOCAI_MODEL",
            "HOCAI_MODEL",
            "OKR_LLM_MODEL",
            "LLM_MODEL",
        ),
    )
    llm_timeout_seconds: int = Field(
        default=60,
        validation_alias=AliasChoices(
            "OKR_DLG_TIMEOUT_SECONDS",
            "DLG_TIMEOUT_SECONDS",
            "OKR_LLM_TIMEOUT_SECONDS",
            "LLM_TIMEOUT_SECONDS",
        ),
    )
    llm_timeout_ms: int | None = Field(
        default=None,
        validation_alias=AliasChoices("OKR_LLM_TIMEOUT_MS", "LLM_TIMEOUT_MS"),
    )
    llm_temperature: float = Field(
        default=0.2,
        validation_alias=AliasChoices(
            "OKR_DLG_TEMPERATURE",
            "DLG_TEMPERATURE",
            "OKR_LLM_TEMPERATURE",
            "LLM_TEMPERATURE",
        ),
    )
    llm_top_p: float = Field(
        default=0.95,
        validation_alias=AliasChoices("OKR_DLG_TOP_P", "DLG_TOP_P", "OKR_LLM_TOP_P", "LLM_TOP_P"),
    )
    llm_max_tokens: int = Field(
        default=1500,
        validation_alias=AliasChoices(
            "OKR_DLG_MAX_TOKENS",
            "DLG_MAX_TOKENS",
            "OKR_LLM_MAX_TOKENS",
            "LLM_MAX_TOKENS",
        ),
    )
    llm_max_retries: int = Field(
        default=2,
        validation_alias=AliasChoices(
            "OKR_DLG_MAX_RETRIES",
            "DLG_MAX_RETRIES",
            "OKR_LLM_MAX_RETRIES",
            "LLM_MAX_RETRIES",
        ),
    )
    llm_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("OKR_LLM_ENABLED", "LLM_ENABLED"),
    )

    model_config = SettingsConfigDict(
        env_file=(WORKSPACE_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        env_prefix="OKR_",
        extra="ignore",
        populate_by_name=True,
    )

    @cached_property
    def effective_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self.storage_dir / 'okr_automation.db'}"

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @cached_property
    def effective_llm_timeout_seconds(self) -> float:
        if self.llm_timeout_ms is not None:
            return self.llm_timeout_ms / 1000
        return float(self.llm_timeout_seconds)


settings = Settings()
