from __future__ import annotations

import argparse
import asyncio
import json
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings
from app.core.database import SessionFactory
from app.services.auth import initialize_admin as run_initialize_admin
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
