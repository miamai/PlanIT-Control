from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.models.entities import Base, CrewReport, EventOutbox, HazardType, RiskScore, Site
from app.services.live_scoring import NewReportWatcher, operational_date, rescore_sites
from app.services.ml import MLClient


def _site(eia_plant_id: int, timezone: str = "America/New_York", ml_site_id: str | None = None):
    return Site(
        eia_plant_id=eia_plant_id,
        name=f"Plant {eia_plant_id}",
        latitude=27.5,
        longitude=-80.3,
        state="FL",
        county="Test",
        timezone=timezone,
        source_release="test",
        source_url="test",
        source_metadata={},
        ml_site_id=ml_site_id,
        ml_model_version="v1" if ml_site_id else None,
    )


def _report(site: Site, reported_at: datetime) -> CrewReport:
    return CrewReport(
        site_id=site.id,
        hazard_type=HazardType.WILDLIFE,
        description="Alligator near the laydown yard",
        latitude=site.latitude,
        longitude=site.longitude,
        reported_at=reported_at,
        reporter_subject="tester",
    )


async def _database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _advisory_lock(dbapi_connection, _record) -> None:
        dbapi_connection.create_function("pg_try_advisory_xact_lock", 1, lambda key: 1)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def _ml_client(index_by_site: dict[str, float], requests: list[dict]) -> MLClient:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        if body["site_id"] not in index_by_site:
            return httpx.Response(500, json={"detail": "model failed"})
        return httpx.Response(
            200,
            json={
                "site_id": body["site_id"],
                "date": body["date"],
                "hazard_index": index_by_site[body["site_id"]],
                "recommendation": "go",
                "sub_scores": {"wildlife": index_by_site[body["site_id"]]},
                "model_version": "v1",
            },
        )

    return MLClient(Settings(ml_base_url="http://ml"), transport=httpx.MockTransport(handler))


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 10, 17, 21, 59, tzinfo=UTC), date(2026, 10, 17)),  # 17:59 in New York
        (datetime(2026, 10, 17, 22, 0, tzinfo=UTC), date(2026, 10, 18)),  # 18:00, briefing hour
        (datetime(2026, 10, 18, 3, 0, tzinfo=UTC), date(2026, 10, 18)),  # 23:00 the day before
    ],
)
def test_operational_day_switches_to_tomorrow_at_the_briefing_hour(now, expected) -> None:
    assert operational_date(_site(1), now) == expected


def test_operational_day_uses_the_sites_own_timezone() -> None:
    now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)  # 19:00 in New York, 16:00 in Los Angeles
    assert operational_date(_site(1, "America/New_York"), now) == date(2026, 10, 18)
    assert operational_date(_site(2, "America/Los_Angeles"), now) == date(2026, 10, 17)


@pytest.mark.asyncio
async def test_rescoring_refreshes_the_days_score_in_place() -> None:
    engine, factory = await _database()
    async with factory() as session:
        covered = _site(7954, ml_site_id="EIA-7954")
        uncovered = _site(1234)
        session.add_all([covered, uncovered])
        await session.commit()

    index = {"EIA-7954": 2.0}
    requests: list[dict] = []
    client = _ml_client(index, requests)
    morning = datetime(2026, 10, 17, 13, 0, tzinfo=UTC)  # 09:00 in New York

    first = await rescore_sites(factory, client, morning)
    index["EIA-7954"] = 4.5
    later = await rescore_sites(factory, client, morning + timedelta(minutes=15))

    assert (first.scored, later.scored, first.failed) == (1, 1, 0)
    # Only the covered site is sent, for today, before the briefing hour.
    assert [(body["site_id"], body["date"]) for body in requests] == [
        ("EIA-7954", "2026-10-17"),
        ("EIA-7954", "2026-10-17"),
    ]
    async with factory() as session:
        scores = (await session.scalars(select(RiskScore))).all()
        assert len(scores) == 1
        score = scores[0]
        assert (score.prediction_date, score.score, score.score_source) == (
            date(2026, 10, 17),
            4.5,
            "ml_service",
        )
        assert score.generated_at.replace(tzinfo=UTC) == morning + timedelta(minutes=15)
        events = await session.scalar(
            select(func.count()).where(EventOutbox.event_type == "risk.updated")
        )
        assert events == 2
    await engine.dispose()


@pytest.mark.asyncio
async def test_one_failing_site_does_not_stop_the_pass() -> None:
    engine, factory = await _database()
    async with factory() as session:
        session.add_all([_site(1, ml_site_id="EIA-1"), _site(2, ml_site_id="EIA-2")])
        await session.commit()

    requests: list[dict] = []
    result = await rescore_sites(
        factory, _ml_client({"EIA-2": 3.0}, requests), datetime(2026, 10, 17, 13, 0, tzinfo=UTC)
    )

    assert (result.scored, result.failed) == (1, 1)
    assert "Plant 1" in result.first_error
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(RiskScore)) == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_rescoring_can_be_limited_to_sites_with_new_reports() -> None:
    engine, factory = await _database()
    async with factory() as session:
        quiet, reported = _site(1, ml_site_id="EIA-1"), _site(2, ml_site_id="EIA-2")
        session.add_all([quiet, reported])
        await session.commit()

    now = datetime(2026, 10, 17, 13, 0, tzinfo=UTC)
    watcher = NewReportWatcher()
    async with factory() as session:
        assert await watcher.sites_with_new_reports(session, now) == set()
        # Observed two hours ago but submitted now: found by id, not by its timestamp.
        session.add(_report(reported, now - timedelta(hours=2)))
        await session.commit()
        sites = await watcher.sites_with_new_reports(session, now)
        assert sites == {reported.id}
        assert await watcher.sites_with_new_reports(session, now) == set()

    requests: list[dict] = []
    result = await rescore_sites(
        factory, _ml_client({"EIA-1": 1.0, "EIA-2": 5.0}, requests), now, sites
    )
    assert result.scored == 1
    assert [body["site_id"] for body in requests] == ["EIA-2"]
    assert [report["hazard_type"] for report in requests[0]["crew_reports"]] == ["wildlife"]
    await engine.dispose()
