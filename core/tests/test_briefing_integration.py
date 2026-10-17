import os
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.entities import Base, Site
from app.services.briefing import generate_due_briefings

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is required")


@pytest.mark.asyncio
async def test_briefing_is_local_time_and_idempotent() -> None:
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        session.add(
            Site(
                eia_plant_id=999001,
                name="Timezone Test",
                latitude=40.7,
                longitude=-74,
                state="NY",
                county="Test",
                timezone="America/New_York",
                source_release="test",
                source_url="test",
                source_metadata={},
            )
        )
        await session.commit()
        now = datetime(2026, 11, 2, 23, 0, tzinfo=UTC)  # 18:00 EST after DST transition
        assert await generate_due_briefings(session, now) == 1
        await session.commit()
        assert await generate_due_briefings(session, now) == 0
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await engine.dispose()
