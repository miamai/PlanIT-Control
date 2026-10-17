from __future__ import annotations

import argparse
import asyncio
import json
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import SessionFactory
from app.models.entities import Site
from app.providers.weather import NWSWeatherProvider
from app.services.auth import initialize_admin as run_initialize_admin
from app.services.backfill import (
    MAX_SCORE_DAYS,
    MAX_WEATHER_HOURS,
    backfill_risk_scores,
    backfill_weather,
)
from app.services.briefing import generate_due_briefings
from app.services.database_check import inspect_database
from app.services.eia import (
    CACHE_PATH,
    download_eia_workbook,
    import_plants,
    parse_cached_sites,
    parse_eia_workbook,
)
from app.services.ml import MLClient, sync_ml_sites
from app.services.seed import seed_demo as run_seed_demo


async def _import(path: str | None, download: bool) -> None:
    source = "cached official snapshot"
    if path:
        records = parse_eia_workbook(Path(path))
        source = str(path)
    elif download:
        with tempfile.TemporaryDirectory() as directory:
            workbook = await download_eia_workbook(Path(directory) / "eia860m.xlsx")
            records = parse_eia_workbook(workbook)
        source = "official EIA download"
    else:
        records = parse_cached_sites(CACHE_PATH)
    async with SessionFactory() as session:
        count = await import_plants(session, records)
    print(f"Imported/refreshed {count} authentic EIA reference sites from {source}.")


def import_sites() -> None:
    parser = argparse.ArgumentParser(description="Import EIA-860M reference plant locations")
    parser.add_argument("--file", help="Path to an official EIA-860M XLSX workbook")
    parser.add_argument(
        "--download", action="store_true", help="Download the configured official release"
    )
    args = parser.parse_args()
    asyncio.run(_import(args.file, args.download))


async def _seed() -> None:
    async with SessionFactory() as session:
        result = await run_seed_demo(session, get_settings())
    print(f"Seeded demo: {result}")


def seed_demo() -> None:
    asyncio.run(_seed())


async def _database_check() -> int:
    settings = get_settings()
    try:
        async with SessionFactory() as session:
            result = await inspect_database(session, settings)
        print(json.dumps(result.to_dict(), indent=2, default=str))
        return 0 if result.ok else 1
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "backend": "postgresql",
                    "error": type(exc).__name__,
                    "detail": "Database readiness check could not complete",
                },
                indent=2,
            )
        )
        return 2


def database_check() -> None:
    raise SystemExit(asyncio.run(_database_check()))


async def _initialize_admin() -> int:
    async with SessionFactory() as session:
        try:
            await run_initialize_admin(session, get_settings())
        except ValueError as exc:
            print(f"Initial admin was not created: {exc}")
            return 1
    print("Created initial administrator account.")
    return 0


def initialize_admin() -> None:
    raise SystemExit(asyncio.run(_initialize_admin()))


async def _sync_ml() -> int:
    settings = get_settings()
    async with SessionFactory() as session:
        count = await sync_ml_sites(session, MLClient(settings))
    print(f"Synchronized {count} ML-supported sites.")
    return 0


def sync_ml_catalog() -> None:
    raise SystemExit(asyncio.run(_sync_ml()))


async def _generate_ml(site_id: uuid.UUID, now: datetime) -> int:
    settings = get_settings()
    async with SessionFactory() as session:
        count = await generate_due_briefings(
            session, now, settings.data_stale_minutes, settings, site_id=site_id
        )
        await session.commit()
    print(f"Generated or refreshed {count} briefing(s).")
    return 0 if count else 1


def generate_ml_briefing() -> None:
    parser = argparse.ArgumentParser(description="Generate a due next-day ML briefing for one site")
    parser.add_argument("site_id", type=uuid.UUID)
    parser.add_argument("--now", type=datetime.fromisoformat, default=datetime.now(UTC))
    args = parser.parse_args()
    now = args.now if args.now.tzinfo else args.now.replace(tzinfo=UTC)
    raise SystemExit(asyncio.run(_generate_ml(args.site_id, now)))


async def _backfill(
    site_id: uuid.UUID | None, days: int, weather_hours: int, scores: bool, weather: bool
) -> int:
    settings = get_settings()
    now = datetime.now(UTC)
    failed: list[str] = []
    async with SessionFactory() as session:
        query = (
            select(Site).where(Site.id == site_id)
            if site_id
            else select(Site).where(Site.ml_site_id.is_not(None))
        )
        sites = list((await session.scalars(query.order_by(Site.name))).all())
        if not sites:
            print("No matching sites. Run planit-ml-sync-sites first, or pass a site id.")
            return 1
        if scores:
            client = MLClient(settings)
            stored = skipped = 0
            for number, site in enumerate(sites, start=1):
                if not site.ml_supported:
                    print(f"[{number}/{len(sites)}] {site.name}: not covered by the model, skipped")
                    continue
                result = await backfill_risk_scores(session, client, [site], days, now)
                stored, skipped = stored + result.stored, skipped + result.skipped
                failed += result.failed
                print(
                    f"[{number}/{len(sites)}] {site.name}: {result.stored} scored, "
                    f"{result.skipped} already stored, {len(result.failed)} failed"
                )
            print(f"Hazard index: {stored} backfilled day(s) stored, {skipped} already stored.")
        if weather:
            async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as http:
                provider = NWSWeatherProvider(http, settings.nws_user_agent)
                stored = 0
                for number, site in enumerate(sites, start=1):
                    result = await backfill_weather(session, provider, [site], weather_hours, now)
                    stored += result.stored
                    failed += result.failed
                    print(f"[{number}/{len(sites)}] {site.name}: {result.stored} weather rows")
            print(
                f"Weather: {stored} station reading row(s) stored for the last {weather_hours} h."
            )
    for line in failed:
        print(f"Failed: {line}")
    return 1 if failed else 0


def backfill() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Fill recent history: score past days through the ML service (stored as "
            "backfilled) and store past NWS station readings. Defaults to every ML-covered site."
        )
    )
    parser.add_argument("site_id", type=uuid.UUID, nargs="?", help="Only this site")
    parser.add_argument(
        "--days", type=int, default=MAX_SCORE_DAYS, help="Days of hazard index, today included"
    )
    parser.add_argument(
        "--weather-hours", type=int, default=24, help="Hours of station readings to fetch"
    )
    parser.add_argument("--skip-scores", action="store_true")
    parser.add_argument("--skip-weather", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.days <= MAX_SCORE_DAYS:
        parser.error(f"--days must be between 1 and {MAX_SCORE_DAYS}")
    if not 1 <= args.weather_hours <= MAX_WEATHER_HOURS:
        parser.error(f"--weather-hours must be between 1 and {MAX_WEATHER_HOURS}")
    raise SystemExit(
        asyncio.run(
            _backfill(
                args.site_id,
                args.days,
                args.weather_hours,
                scores=not args.skip_scores,
                weather=not args.skip_weather,
            )
        )
    )
