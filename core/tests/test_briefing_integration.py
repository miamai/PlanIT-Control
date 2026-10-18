import os
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.models.entities import (
    Base,
    CrewReport,
    HazardType,
    RiskScore,
    SafetyBriefing,
    Site,
)
from app.services.briefing import generate_due_briefings
from app.services.ml import MLBriefing

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


@pytest.mark.asyncio
async def test_ml_briefing_persists_score_and_uses_previous_briefing_cutoff() -> None:
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)

    class FakeMLClient:
        reports: list[CrewReport] = []

        async def briefing(self, site, prediction_date, alerts, reports):
            self.reports = reports
            return MLBriefing.model_validate(
                {
                    "risk": {
                        "site_id": "EIA-999002",
                        "date": prediction_date.isoformat(),
                        "hazard_index": 6.2,
                        "recommendation": "caution",
                        "sub_scores": {"heat": 6.2},
                        "model_version": "v1",
                    },
                    "briefing": "Decision: CAUTION. Heat is the validated primary concern.",
                    "source": "gemini:gemini-3.8-flash",
                }
            )

    client = FakeMLClient()
    async with factory() as session:
        site = Site(
            eia_plant_id=999002,
            name="ML Test",
            latitude=40.7,
            longitude=-74,
            state="NY",
            county="Test",
            timezone="America/New_York",
            source_release="test",
            source_url="test",
            source_metadata={},
            ml_site_id="EIA-999002",
            ml_model_version="v1",
        )
        session.add(site)
        await session.flush()
        session.add(
            SafetyBriefing(
                site_id=site.id,
                briefing_date=date(2026, 10, 17),
                generated_at=now - timedelta(hours=2),
                summary="Prior briefing",
                hazard_details={"generation_status": "generated"},
            )
        )
        session.add_all(
            [
                CrewReport(
                    site_id=site.id,
                    hazard_type=HazardType.HEAT,
                    description="old",
                    latitude=site.latitude,
                    longitude=site.longitude,
                    image_metadata={},
                    reported_at=now - timedelta(hours=3),
                    reporter_subject="crew-old",
                    verification_status="unverified",
                ),
                CrewReport(
                    site_id=site.id,
                    hazard_type=HazardType.HEAT,
                    description="new",
                    latitude=site.latitude,
                    longitude=site.longitude,
                    image_metadata={},
                    reported_at=now - timedelta(hours=1),
                    reporter_subject="crew-new",
                    verification_status="verified",
                ),
            ]
        )
        await session.commit()
        settings = Settings(ml_enabled=True)
        assert await generate_due_briefings(session, now, settings=settings, ml_client=client) == 1
        await session.commit()
        assert [report.description for report in client.reports] == ["new"]
        risk = await session.scalar(select(RiskScore).where(RiskScore.site_id == site.id))
        assert risk is not None
        assert risk.prediction_date == date(2026, 10, 18)
        assert risk.score == 6.2
        assert await generate_due_briefings(session, now, settings=settings, ml_client=client) == 0
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
    await engine.dispose()
