from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from math import degrees

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.models.entities import AlertStatus, Base, LightningSiteState, Site
from app.schemas.domain import LightningStrikeInput
from app.services.lightning import expire_lightning_alerts, process_strike
from app.utils.geo import EARTH_RADIUS_MILES

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is required")


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as value:
        yield value
        await value.rollback()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await engine.dispose()


async def add_site(session, plant_id=1, lat=0.0, lon=0.0):
    site = Site(
        eia_plant_id=plant_id,
        name=f"Site {plant_id}",
        latitude=lat,
        longitude=lon,
        state="TX",
        county="Test",
        timezone="UTC",
        source_release="test",
        source_url="test",
        source_metadata={},
    )
    session.add(site)
    await session.flush()
    return site


def strike(strike_id: str, longitude: float, occurred_at: datetime) -> LightningStrikeInput:
    return LightningStrikeInput(
        strike_id=strike_id,
        latitude=0,
        longitude=longitude,
        occurred_at=occurred_at,
        provider="test",
    )


@pytest.mark.asyncio
async def test_inside_outside_and_exact_boundary(session) -> None:
    await add_site(session)
    settings = Settings(environment="test", database_url=TEST_DATABASE_URL)
    now = datetime.now(UTC)
    five_miles = degrees(5 / EARTH_RADIUS_MILES)
    exact_ten = degrees(10 / EARTH_RADIUS_MILES)
    outside = degrees(10.01 / EARTH_RADIUS_MILES)
    assert len(await process_strike(session, strike("inside", five_miles, now), settings)) == 1
    assert (
        len(
            await process_strike(
                session, strike("outside", outside, now + timedelta(seconds=1)), settings
            )
        )
        == 0
    )
    assert (
        len(
            await process_strike(
                session, strike("boundary", exact_ten, now + timedelta(seconds=2)), settings
            )
        )
        == 1
    )


@pytest.mark.asyncio
async def test_newer_resets_duplicate_and_older_do_not(session) -> None:
    site = await add_site(session)
    settings = Settings(environment="test", database_url=TEST_DATABASE_URL)
    now = datetime.now(UTC)
    near = degrees(5 / EARTH_RADIUS_MILES)
    await process_strike(session, strike("first", near, now), settings)
    await process_strike(session, strike("second", near, now + timedelta(minutes=10)), settings)
    assert (
        await process_strike(session, strike("second", near, now + timedelta(minutes=10)), settings)
        == []
    )
    assert (
        await process_strike(session, strike("older", near, now - timedelta(minutes=1)), settings)
        == []
    )
    state = await session.get(LightningSiteState, site.id)
    assert state.all_clear_eligible_at == now + timedelta(minutes=40)


@pytest.mark.asyncio
async def test_expiration_after_restart_safe_state(session) -> None:
    await add_site(session)
    settings = Settings(environment="test", database_url=TEST_DATABASE_URL)
    now = datetime.now(UTC)
    near = degrees(5 / EARTH_RADIUS_MILES)
    await process_strike(session, strike("first", near, now), settings)
    await session.commit()
    changed = await expire_lightning_alerts(session, now + timedelta(minutes=31))
    assert len(changed) == 1
    assert changed[0].status == AlertStatus.ALL_CLEAR_ELIGIBLE


@pytest.mark.asyncio
async def test_multiple_sites_are_independent(session) -> None:
    await add_site(session, plant_id=1, lon=0)
    await add_site(session, plant_id=2, lon=1)
    settings = Settings(environment="test", database_url=TEST_DATABASE_URL)
    changed = await process_strike(
        session, strike("one-site", degrees(5 / EARTH_RADIUS_MILES), datetime.now(UTC)), settings
    )
    assert len(changed) == 1
