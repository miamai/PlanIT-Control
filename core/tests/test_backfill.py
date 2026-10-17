from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.main import app
from app.models.entities import Base, RiskScore, Site, UserAccount, UserRole, UserStatus
from app.providers.weather import NWSWeatherProvider
from app.services.auth import hash_password, issue_token_pair
from app.services.backfill import BACKFILL_SCORE_SOURCE, backfill_risk_scores
from app.services.ml import MLClient

NOW = datetime(2026, 10, 17, 22, 0, tzinfo=UTC)  # 17:00 in Chicago
TODAY = date(2026, 10, 17)


def _site(eia_plant_id: int, covered: bool = True) -> Site:
    return Site(
        eia_plant_id=eia_plant_id,
        name=f"Plant {eia_plant_id}",
        latitude=30,
        longitude=-90,
        state="LA",
        county="Test",
        timezone="America/Chicago",
        source_release="test",
        source_url="test",
        source_metadata={},
        is_reference_location=True,
        ml_site_id=f"EIA-{eia_plant_id}" if covered else None,
        ml_model_version="v1" if covered else None,
    )


def _score(site: Site, day: date, value: float, source: str, generated_at: datetime) -> RiskScore:
    return RiskScore(
        site_id=site.id,
        score=value,
        generated_at=generated_at,
        prediction_date=day,
        valid_for_seconds=86400,
        model_version="v1",
        score_source=source,
        contributing_factors={},
    )


@pytest.mark.asyncio
async def test_score_backfill_fills_missing_days_and_labels_them() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    requested: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requested.append(body)
        assert request.url.path == "/score"
        if body["date"] == (TODAY - timedelta(days=3)).isoformat():
            return httpx.Response(503, json={"detail": "rate limited"})
        return httpx.Response(
            200,
            json={
                "site_id": body["site_id"],
                "date": body["date"],
                "hazard_index": 4.0,
                "recommendation": "caution",
                "sub_scores": {"heat": 4.0},
                "reasons": [{"hazard": "heat", "impact": 1.0, "text": "Hot"}],
                "model_version": "v1",
            },
        )

    client = MLClient(Settings(ml_base_url="http://ml"), transport=httpx.MockTransport(handler))
    async with factory() as session:
        covered, uncovered = _site(1), _site(2, covered=False)
        session.add_all([covered, uncovered])
        await session.flush()
        # A forward prediction already stored for yesterday is kept, not rescored.
        session.add(_score(covered, TODAY - timedelta(days=1), 6.0, "ml_service", NOW))
        await session.commit()

        result = await backfill_risk_scores(session, client, [covered, uncovered], days=4, now=NOW)

        assert [body["date"] for body in requested] == [
            (TODAY - timedelta(days=3)).isoformat(),
            (TODAY - timedelta(days=2)).isoformat(),
            TODAY.isoformat(),
        ]
        assert all(body["site_id"] == "EIA-1" for body in requested)
        assert (result.stored, result.skipped, len(result.failed)) == (2, 1, 1)
        rows = (await session.scalars(select(RiskScore).order_by(RiskScore.prediction_date))).all()
        assert [(row.prediction_date, row.score_source) for row in rows] == [
            (TODAY - timedelta(days=2), BACKFILL_SCORE_SOURCE),
            (TODAY - timedelta(days=1), "ml_service"),
            (TODAY, BACKFILL_SCORE_SOURCE),
        ]
        backfilled = rows[0]
        assert backfilled.contributing_factors["backfilled"] is True
        assert backfilled.contributing_factors["sub_scores"] == {"heat": 4.0}
        assert backfilled.contributing_factors["recommendation"] == "caution"

        # Rerunning stores nothing new.
        requested.clear()
        again = await backfill_risk_scores(session, client, [covered], days=4, now=NOW)
        assert [body["date"] for body in requested] == [(TODAY - timedelta(days=3)).isoformat()]
        assert again.stored == 0 and again.skipped == 3
    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_rejects_days_the_model_cannot_score() -> None:
    client = MLClient(Settings(ml_base_url="http://ml"))
    with pytest.raises(ValueError, match="days"):
        await backfill_risk_scores(None, client, [], days=15)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_backfilled_scores_are_history_only() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    now = datetime.now(UTC)
    today = now.astimezone(ZoneInfo("America/Chicago")).date()
    async with factory() as session:
        site = _site(3)
        user = UserAccount(
            username="backfill-tester",
            password_hash=hash_password("testing-password"),
            role=UserRole.USER,
            status=UserStatus.ACTIVE,
        )
        session.add_all([site, user])
        await session.flush()
        session.add_all(
            [
                _score(
                    site, today + timedelta(days=1), 3.0, "ml_service", now - timedelta(hours=2)
                ),
                # Generated later, but only history.
                _score(site, today - timedelta(days=1), 8.0, BACKFILL_SCORE_SOURCE, now),
            ]
        )
        token, _, _, _ = await issue_token_pair(session, user, get_settings())
        await session.commit()
        site_id = site.id

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            current = await client.get(f"/api/sites/{site_id}/risk", headers=headers)
            history = await client.get(f"/api/sites/{site_id}/risk/history", headers=headers)
            rankings = await client.get("/api/risk/rankings", headers=headers)
        assert current.json()["data"]["score"]["score"] == 3.0
        assert [(row["score"], row["score_source"]) for row in history.json()["data"]] == [
            (8.0, BACKFILL_SCORE_SOURCE),
        ]
        assert rankings.json()["data"][0]["risk"]["score"] == 3.0
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def _reading(timestamp: str, temperature: float, hourly_report: bool = False) -> dict:
    props = {
        "timestamp": timestamp,
        "temperature": {"value": temperature},
        "relativeHumidity": {"value": 60.0},
        "windSpeed": {"value": 18.0},
    }
    if hourly_report:
        props["precipitationLastHour"] = {"value": 1.5}
    return {"properties": props}


@pytest.mark.asyncio
@respx.mock
async def test_nws_history_keeps_one_reading_per_hour_back_to_start() -> None:
    site = SimpleNamespace(id=uuid4(), eia_plant_id=1, latitude=39.0, longitude=-77.0)
    stations_url = "https://api.weather.gov/gridpoints/LWX/1,2/stations"
    station = "https://api.weather.gov/stations/KDCA"
    next_page = f"{station}/observations?cursor=abc"
    respx.get("https://api.weather.gov/points/39.0000,-77.0000").mock(
        return_value=httpx.Response(200, json={"properties": {"observationStations": stations_url}})
    )
    respx.get(stations_url).mock(
        return_value=httpx.Response(200, json={"features": [{"id": station}]})
    )
    first = respx.get(f"{station}/observations", params={"limit": "500"}).mock(
        return_value=httpx.Response(
            200,
            json={
                "features": [
                    _reading("2026-10-17T21:05:00+00:00", 30.0),
                    _reading("2026-10-17T20:56:00+00:00", 31.0, hourly_report=True),
                    _reading("2026-10-17T20:40:00+00:00", 32.0),
                ],
                "pagination": {"next": next_page},
            },
        )
    )
    second = respx.get(next_page).mock(
        return_value=httpx.Response(
            200,
            json={
                "features": [
                    _reading("2026-10-17T19:50:00+00:00", 29.0),
                    _reading("2026-10-17T19:10:00+00:00", 28.0),  # before start
                ],
                "pagination": {"next": f"{station}/observations?cursor=older"},
            },
        )
    )
    start = datetime(2026, 10, 17, 19, 30, tzinfo=UTC)
    async with httpx.AsyncClient() as client:
        rows = await NWSWeatherProvider(client, "test@example.com").fetch_history([site], start)

    assert first.called and second.called
    assert first.calls[0].request.url.params["start"] == start.isoformat()
    temperatures = sorted(
        (row.observed_at.isoformat(), row.numeric_value)
        for row in rows
        if row.metric_name == "temperature"
    )
    # 20:xx keeps the routine hourly report (it carries rainfall), not the newest reading.
    assert temperatures == [
        ("2026-10-17T19:50:00+00:00", 29.0),
        ("2026-10-17T20:56:00+00:00", 31.0),
        ("2026-10-17T21:05:00+00:00", 30.0),
    ]
    rainfall = [row for row in rows if row.metric_name == "precipitation_accumulation"]
    assert [row.numeric_value for row in rainfall] == [1.5]
    assert rainfall[0].source_event_id == f"{station}:2026-10-17T20:56:00+00:00"
    assert {row.metric_name for row in rows} >= {"wind_speed", "calculated_heat_index"}
    assert all(row.metadata["backfilled"] is True for row in rows)
