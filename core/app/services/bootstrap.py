from __future__ import annotations

import asyncio
import subprocess
import sys
from collections.abc import Awaitable, Callable

import structlog
from sqlalchemy import func, select, text

from app.core.config import Settings
from app.core.database import SessionFactory
from app.models.entities import Site, UserAccount
from app.services.auth import initialize_admin
from app.services.database_check import inspect_database
from app.services.eia import (
    EIA_API_URL,
    fetch_eia_api_records,
    import_plants,
    parse_cached_sites,
    select_reference_sites,
)
from app.services.ml import MLClient, sync_ml_sites

log = structlog.get_logger()
BOOTSTRAP_LOCK = 73011820261017


async def _migrate() -> None:
    await asyncio.to_thread(
        subprocess.run, [sys.executable, "-m", "alembic", "upgrade", "head"], check=True
    )


async def _admin(settings: Settings) -> None:
    async with SessionFactory() as session:
        if await session.scalar(select(func.count()).select_from(UserAccount)):
            log.info("bootstrap_step_skipped", step="admin", reason="user_exists")
            return
        if settings.environment == "production" and (
            settings.initial_admin_username in {None, "admin", "administrator"}
            or settings.initial_admin_password is None
            or settings.initial_admin_password.get_secret_value()
            in {"admin", "password", "change-me"}
        ):
            raise ValueError("Production admin credentials must not use placeholders")
        await initialize_admin(session, settings)


async def _sites(settings: Settings, refresh: bool) -> None:
    async with SessionFactory() as session:
        count = await session.scalar(select(func.count()).select_from(Site))
        if count and not refresh:
            log.info("bootstrap_step_skipped", step="sites", reason="sites_exist", count=count)
            return
        source = "snapshot"
        try:
            if settings.eia_api_key:
                records = await fetch_eia_api_records(
                    settings.eia_api_key.get_secret_value(),
                    timeout_seconds=settings.request_timeout_seconds * 4,
                )
                source = "eia_api"
            else:
                records = parse_cached_sites()
        except Exception as exc:  # noqa: BLE001 - snapshot is the startup fallback
            if count:
                raise
            log.warning("eia_api_failed_using_snapshot", error=type(exc).__name__)
            records = parse_cached_sites()
        selected = select_reference_sites(
            records, per_state=settings.sites_per_state, maximum=settings.sites_max
        )
        kwargs = (
            {"source_release": "EIA API", "source_url": EIA_API_URL} if source == "eia_api" else {}
        )
        await import_plants(session, selected, **kwargs)
        log.info("bootstrap_sites_source", source=source, count=len(selected))


async def _ml_sync(settings: Settings) -> None:
    deadline = asyncio.get_running_loop().time() + 120
    delay = 1.0
    client = MLClient(settings)
    while True:
        try:
            await client.health()
            break
        except Exception as exc:  # noqa: BLE001 - retry until timeout
            if asyncio.get_running_loop().time() >= deadline:
                if settings.environment == "production":
                    raise RuntimeError(
                        "ML service did not become healthy within 120 seconds"
                    ) from exc
                log.warning("bootstrap_ml_unavailable", error=type(exc).__name__)
                return
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10)
    async with SessionFactory() as session:
        count = await sync_ml_sites(session, client)
    log.info("bootstrap_ml_synced", count=count)


async def _check(settings: Settings) -> None:
    async with SessionFactory() as session:
        result = await inspect_database(session, settings)
    log.info("bootstrap_database_check", **result.to_dict())
    if not result.ok:
        raise RuntimeError("Database schema check failed")


async def run_bootstrap(*, only: str | None = None, refresh_sites: bool = False) -> None:
    settings = Settings()
    settings.validate_runtime()
    steps: list[tuple[str, Callable[[], Awaitable[None]]]] = [
        ("migrate", _migrate),
        ("admin", lambda: _admin(settings)),
        ("sites", lambda: _sites(settings, refresh_sites)),
        ("ml-sync", lambda: _ml_sync(settings)),
        ("check", lambda: _check(settings)),
    ]
    if only and only not in {name for name, _ in steps}:
        raise ValueError(f"Unknown bootstrap step: {only}")
    async with SessionFactory() as lock_session:
        if lock_session.bind and lock_session.bind.dialect.name == "postgresql":
            await lock_session.execute(
                text("SELECT pg_advisory_lock(:key)"), {"key": BOOTSTRAP_LOCK}
            )
        try:
            for name, step in steps:
                if only and name != only:
                    continue
                log.info("bootstrap_step_started", step=name)
                await step()
                log.info("bootstrap_step_done", step=name)
        finally:
            if lock_session.bind and lock_session.bind.dialect.name == "postgresql":
                await lock_session.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": BOOTSTRAP_LOCK}
                )
