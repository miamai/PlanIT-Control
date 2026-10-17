from __future__ import annotations

import pytest

from app.core.config import Settings
from app.services.database_check import application_migration_head


def test_application_migration_head_is_frozen_revision() -> None:
    assert application_migration_head() == "20261017_0004"


def test_production_requires_database_tls() -> None:
    settings = Settings(
        environment="production",
        jwt_secret_key="a-unique-production-secret-that-is-over-32-bytes",
        alert_threshold_profile="disabled",
        db_require_tls=False,
    )

    with pytest.raises(ValueError, match="DB_REQUIRE_TLS"):
        settings.validate_runtime()


def test_external_provider_polling_is_opt_in() -> None:
    assert Settings(_env_file=None).enabled_providers == []


def test_tiger_libpq_url_is_normalized_for_asyncpg() -> None:
    settings = Settings(
        _env_file=None,
        database_url="postgresql://user:secret@db.example.com:5432/app?sslmode=require",
    )

    assert settings.database_url == (
        "postgresql+asyncpg://user:secret@db.example.com:5432/app?ssl=require"
    )
