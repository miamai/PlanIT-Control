from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import SessionFactory
from app.core.logging import configure_logging
from app.services.briefing import generate_due_briefings
from app.services.ingestion import run_provider
from app.services.lightning import expire_lightning_alerts

log = structlog.get_logger()


async def _with_lock(lock_key: int, operation) -> bool:
    async with SessionFactory() as session:
        acquired = await session.scalar(
            text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": lock_key}
        )
        if not acquired:
            await session.rollback()
            return False
        await operation(session)
        await session.commit()
        return True


async def run() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    all_schedules = {
        "weather": settings.weather_poll_seconds,
        "weather_alerts": settings.weather_alert_poll_seconds,
        "usgs": settings.usgs_poll_seconds,
        "wildfire": settings.wildfire_poll_seconds,
        "soil": max(settings.weather_poll_seconds, 3600),
    }
    schedules = {
        name: interval
        for name, interval in all_schedules.items()
        if name in settings.enabled_providers
    }
    next_due = {name: datetime.now(UTC) for name in schedules}
    while True:
        now = datetime.now(UTC)
        for index, (provider, interval) in enumerate(schedules.items(), start=1):
            if now < next_due[provider]:
                continue

            async def ingest(session, provider_name=provider):
                result = await run_provider(session, provider_name, settings)
                await log.ainfo(
                    "provider_run",
                    provider=provider_name,
                    status=result.status,
                    records=result.records_written,
                    error=result.error,
                )

            await _with_lock(710000 + index, ingest)
            next_due[provider] = now + timedelta(seconds=interval)

        async def maintenance(session, maintenance_time=now):
            expired = await expire_lightning_alerts(session, maintenance_time)
            briefings = await generate_due_briefings(
                session, maintenance_time, settings.data_stale_minutes, settings
            )
            if expired or briefings:
                await log.ainfo(
                    "maintenance", lightning_all_clear=len(expired), briefings=briefings
                )

        await _with_lock(719999, maintenance)
        await asyncio.sleep(settings.worker_tick_seconds)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
