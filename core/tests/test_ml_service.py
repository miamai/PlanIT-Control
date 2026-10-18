import json
from datetime import UTC, date, datetime

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.models.entities import Base, CrewReport, HazardType, Site
from app.services.ml import MLClient, sync_ml_sites


def _site() -> Site:
    return Site(
        eia_plant_id=123,
        name="Reference Plant",
        latitude=30,
        longitude=-90,
        state="LA",
        county="Test",
        timezone="America/Chicago",
        source_release="test",
        source_url="test",
        source_metadata={},
        ml_site_id="EIA-123",
        ml_model_version="v1",
    )


@pytest.mark.asyncio
async def test_ml_client_maps_wildlife_category_without_animal_metadata() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "risk": {
                    "site_id": "EIA-123",
                    "date": "2026-10-18",
                    "hazard_index": 4.2,
                    "recommendation": "caution",
                    "sub_scores": {"wildlife": 4.2},
                    "model_version": "v1",
                },
                "briefing": "Decision: CAUTION. Follow the validated plan.",
                "source": "template",
            },
        )

    site = _site()
    report = CrewReport(
        site_id=site.id,
        hazard_type=HazardType.WILDLIFE,
        description="bear mentioned here must not be parsed",
        latitude=30,
        longitude=-90,
        image_metadata={"animal": "  Coyote\x00  "},
        reported_at=datetime(2026, 10, 17, tzinfo=UTC),
        reporter_subject="secret-subject",
        verification_status="verified",
    )
    settings = Settings(ml_base_url="http://ml", ml_briefing_backend="template")
    client = MLClient(settings, transport=httpx.MockTransport(handler))
    result = await client.briefing(site, date(2026, 10, 18), [], [report])
    assert result.risk.hazard_index == 4.2
    assert seen["crew_reports"][0]["hazard_type"] == "wildlife"
    assert "animal" not in seen["crew_reports"][0]
    assert "reporter_subject" not in seen["crew_reports"][0]


@pytest.mark.asyncio
async def test_ml_client_rejects_mock_or_mismatched_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "risk": {
                    "site_id": "EIA-999",
                    "date": "2026-10-18",
                    "hazard_index": 1,
                    "recommendation": "go",
                    "sub_scores": {},
                    "model_version": "v1",
                    "mock": True,
                },
                "briefing": "invalid",
                "source": "template",
            },
        )

    client = MLClient(Settings(ml_base_url="http://ml"), transport=httpx.MockTransport(handler))
    with pytest.raises(ValueError, match="mock"):
        await client.briefing(_site(), date(2026, 10, 18), [], [])


@pytest.mark.asyncio
async def test_site_sync_adds_catalog_sites_without_deleting_existing() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"ok": True, "models_ready": True, "model_version": "v1", "site_count": 1})
        return httpx.Response(
            200,
            json=[{"site_id": "EIA-123", "name": "Catalog Plant", "state": "LA", "county": "Test", "lat": 30, "lon": -90, "timezone": "America/Chicago", "model_version": "v1"}],
        )

    client = MLClient(Settings(ml_base_url="http://ml"), transport=httpx.MockTransport(handler))
    async with factory() as session:
        session.add(
            Site(
                eia_plant_id=999,
                name="Existing",
                latitude=40,
                longitude=-70,
                state="NY",
                timezone="America/New_York",
                source_release="test",
                source_url="test",
                source_metadata={},
                ml_site_id="EIA-999",
                ml_model_version="old-v0",
            )
        )
        await session.commit()
        assert await sync_ml_sites(session, client) == 1
        sites = list((await session.scalars(select(Site))).all())
        assert len(sites) == 2
        assert next(site for site in sites if site.eia_plant_id == 123).ml_supported
        retained = next(site for site in sites if site.eia_plant_id == 999)
        assert retained.ml_supported
        assert retained.ml_model_version == "old-v0"
    await engine.dispose()
