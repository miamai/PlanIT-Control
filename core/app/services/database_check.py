from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings

REQUIRED_TABLES = {
    "sites",
    "hazard_observations",
    "lightning_strikes",
    "alerts",
    "alert_transitions",
    "crew_reports",
    "risk_scores",
    "safety_briefings",
    "provider_runs",
    "event_outbox",
    "user_accounts",
    "refresh_sessions",
}


@dataclass
class DatabaseCheck:
    ok: bool
    backend: str
    host: str | None
    database: str | None
    server_version: str | None
    tls: bool | None
    timescaledb_available: bool
    timescaledb_installed: bool
    timescaledb_version: str | None
    migration_current: str | None
    migration_head: str
    migration_matches: bool
    missing_tables: list[str]
    site_count: int | None
    observation_count: int | None
    errors: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def application_migration_head() -> str:
    core_dir = Path(__file__).resolve().parents[2]
    config = Config(str(core_dir / "alembic.ini"))
    config.set_main_option("script_location", str(core_dir / "alembic"))
    return ScriptDirectory.from_config(config).get_current_head()


async def inspect_database(session: AsyncSession, settings: Settings) -> DatabaseCheck:
    url = make_url(settings.database_url)
    errors: list[str] = []
    head = application_migration_head()
    server_version = await session.scalar(text("SELECT version()"))
    database_name = await session.scalar(text("SELECT current_database()"))

    tls = await session.scalar(text("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"))
    tls = bool(tls)
    if settings.db_require_tls and not tls:
        errors.append("Database connection is not using TLS")

    extension = (
        await session.execute(
            text(
                "SELECT available.default_version, installed.extversion "
                "FROM pg_available_extensions AS available "
                "LEFT JOIN pg_extension AS installed ON installed.extname = available.name "
                "WHERE available.name = 'timescaledb'"
            )
        )
    ).one_or_none()
    timescale_available = extension is not None
    timescale_version = extension[1] if extension else None

    def table_names(connection) -> set[str]:
        return set(inspect(connection).get_table_names())

    connection = await session.connection()
    tables = await connection.run_sync(table_names)
    missing = sorted(REQUIRED_TABLES.difference(tables))
    if missing:
        errors.append(f"Missing required tables: {', '.join(missing)}")

    current = None
    if "alembic_version" in tables:
        current = await session.scalar(text("SELECT version_num FROM alembic_version"))
    migration_matches = current == head
    if not migration_matches:
        errors.append(f"Migration mismatch: database={current or 'none'}, application={head}")

    site_count = (
        await session.scalar(text("SELECT count(*) FROM sites")) if "sites" in tables else None
    )
    observation_count = (
        await session.scalar(text("SELECT count(*) FROM hazard_observations"))
        if "hazard_observations" in tables
        else None
    )
    return DatabaseCheck(
        ok=not errors,
        backend=url.get_backend_name(),
        host=url.host,
        database=database_name,
        server_version=server_version,
        tls=tls,
        timescaledb_available=timescale_available,
        timescaledb_installed=timescale_version is not None,
        timescaledb_version=timescale_version,
        migration_current=current,
        migration_head=head,
        migration_matches=migration_matches,
        missing_tables=missing,
        site_count=site_count,
        observation_count=observation_count,
        errors=errors,
    )
