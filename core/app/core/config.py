from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    app_name: str = "PlanIT Control Core"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+asyncpg://planit:planit@localhost:5432/planit"
    db_require_tls: bool = False
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    jwt_secret_key: str = "development-only-planit-jwt-secret-change-me"
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    refresh_cookie_name: str = "planit_refresh_token"
    # A rotated refresh token presented again this soon after its rotation is a
    # lost response (reload mid-refresh) or a concurrent tab, not a replay.
    refresh_reuse_grace_seconds: int = 30
    initial_admin_username: str | None = None
    initial_admin_password: SecretStr | None = None

    nws_user_agent: str = "PlanIT-Control/0.1 (contact@example.com)"
    request_timeout_seconds: float = 15.0
    nasa_firms_map_key: str | None = None
    lightning_provider: Literal["fixture", "disabled"] = "disabled"

    weather_poll_seconds: int = 900
    weather_alert_poll_seconds: int = 300
    usgs_poll_seconds: int = 900
    wildfire_poll_seconds: int = 2700
    worker_tick_seconds: int = 30
    data_stale_minutes: int = 60
    enabled_providers: list[Literal["weather", "weather_alerts", "usgs", "wildfire", "soil"]] = (
        Field(default_factory=list)
    )
    ml_enabled: bool = False
    ml_base_url: str = "http://localhost:8001"
    ml_timeout_seconds: float = 120.0
    ml_briefing_backend: Literal["gemini", "template", "auto"] = "gemini"

    alert_threshold_profile: Literal["disabled", "demo", "approved"] = "demo"
    heat_high_threshold_f: float = 103.0
    heat_critical_threshold_f: float = 125.0
    soil_moderate_rainfall_mm_72h: float = 50.8
    soil_high_rainfall_mm_72h: float = 101.6

    lightning_radius_miles: float = 10.0
    lightning_all_clear_minutes: int = 30
    wildfire_radius_miles: float = 25.0
    wildlife_share_radius_miles: float = 10.0

    @field_validator("database_url")
    @classmethod
    def require_async_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            value = value.replace("postgresql://", "postgresql+asyncpg://", 1)
        # Tiger and libpq publish sslmode=require, while asyncpg expects the
        # equivalent `ssl=require` query argument.
        value = value.replace("?sslmode=", "?ssl=").replace("&sslmode=", "&ssl=")
        return value

    def validate_runtime(self) -> None:
        if self.environment == "production" and (
            len(self.jwt_secret_key.encode()) < 32
            or self.jwt_secret_key == "development-only-planit-jwt-secret-change-me"
        ):
            raise ValueError("Production requires a unique JWT_SECRET_KEY of at least 32 bytes")
        if self.environment == "production" and not self.db_require_tls:
            raise ValueError("Production requires DB_REQUIRE_TLS=true")
        if self.environment == "production" and self.alert_threshold_profile == "demo":
            raise ValueError("Production requires ALERT_THRESHOLD_PROFILE=approved or disabled")
        if self.environment == "production" and self.ml_enabled and not self.ml_base_url:
            raise ValueError("Production ML integration requires ML_BASE_URL")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime()
    return settings
