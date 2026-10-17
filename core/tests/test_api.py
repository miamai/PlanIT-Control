from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.database import get_session
from app.main import app
from app.models.entities import Base, Site, UserAccount, UserRole, UserStatus
from app.services.auth import hash_password, issue_token_pair


@pytest.mark.asyncio
async def test_site_list_contract_and_jwt_auth() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        session.add(
            Site(
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
                is_reference_location=True,
            )
        )
        user = UserAccount(
            username="tester",
            password_hash=hash_password("testing-password"),
            role=UserRole.USER,
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        await session.flush()
        access_token, _, _, _ = await issue_token_pair(session, user, get_settings())
        await session.commit()

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/sites", headers={"Authorization": f"Bearer {access_token}"}
            )
            invalid = await client.get(
                "/api/sites/not-a-uuid",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["meta"]["total"] == 1
        assert payload["data"][0]["eia_plant_id"] == 123
        assert payload["data"][0]["is_reference_location"] is True
        assert invalid.status_code == 422
        assert invalid.headers["content-type"].startswith("application/problem+json")
        assert invalid.json()["errors"]
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def _seed_site_with_history(factory):
    from datetime import UTC, date, datetime, timedelta

    from app.models.entities import RiskScore, SafetyBriefing

    today = datetime.now(UTC).date()
    async with factory() as session:
        site = Site(
            eia_plant_id=456,
            name="History Plant",
            latitude=29,
            longitude=-95,
            state="TX",
            county="Harris",
            timezone="America/Chicago",
            source_release="test",
            source_url="test",
            source_metadata={},
            is_reference_location=True,
        )
        user = UserAccount(
            username="history-tester",
            password_hash=hash_password("testing-password"),
            role=UserRole.USER,
            status=UserStatus.ACTIVE,
        )
        session.add_all([site, user])
        await session.flush()
        generated = datetime.now(UTC)

        def score(prediction_date: date, value: float, version: str, offset_minutes: int):
            return RiskScore(
                site_id=site.id,
                score=value,
                generated_at=generated - timedelta(minutes=offset_minutes),
                prediction_date=prediction_date,
                valid_for_seconds=86400,
                model_version=version,
                score_source="model",
                contributing_factors={},
            )

        session.add_all(
            [
                score(today - timedelta(days=40), 9.0, "v1", 0),
                score(today - timedelta(days=2), 3.0, "v1", 0),
                score(today - timedelta(days=1), 4.0, "v1", 30),
                score(today - timedelta(days=1), 5.0, "v2", 0),
                score(today, 6.0, "v1", 0),
                SafetyBriefing(
                    site_id=site.id,
                    briefing_date=today,
                    generated_at=generated,
                    summary="Today briefing.",
                    hazard_details={},
                ),
                SafetyBriefing(
                    site_id=site.id,
                    briefing_date=today - timedelta(days=3),
                    generated_at=generated,
                    summary="Older briefing.",
                    hazard_details={},
                ),
            ]
        )
        access_token, _, _, _ = await issue_token_pair(session, user, get_settings())
        await session.commit()
        return site.id, access_token, today


@pytest.mark.asyncio
async def test_risk_history_and_fleet_briefings() -> None:
    from datetime import timedelta

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    site_id, token, today = await _seed_site_with_history(factory)

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            unauthenticated = await client.get(f"/api/sites/{site_id}/risk/history")
            history = await client.get(f"/api/sites/{site_id}/risk/history", headers=headers)
            short = await client.get(
                f"/api/sites/{site_id}/risk/history", params={"days": 1}, headers=headers
            )
            missing = await client.get(
                "/api/sites/00000000-0000-0000-0000-000000000000/risk/history", headers=headers
            )
            all_briefings = await client.get("/api/briefings", headers=headers)
            dated = await client.get(
                "/api/briefings", params={"briefing_date": today.isoformat()}, headers=headers
            )
            since = await client.get(
                "/api/briefings",
                params={"since": (today - timedelta(days=1)).isoformat()},
                headers=headers,
            )
            briefings_unauthenticated = await client.get("/api/briefings")

        assert unauthenticated.status_code == 401
        assert history.status_code == 200
        points = history.json()["data"]
        # The 40-day-old score is outside the default window, and only the latest
        # generated score is kept for a day with two model versions.
        assert [point["score"] for point in points] == [3.0, 5.0, 6.0]
        assert [point["prediction_date"] for point in points] == sorted(
            point["prediction_date"] for point in points
        )
        assert [point["score"] for point in short.json()["data"]] == [5.0, 6.0]
        assert missing.status_code == 404

        assert all_briefings.status_code == 200
        assert all_briefings.json()["meta"]["total"] == 2
        assert [row["summary"] for row in all_briefings.json()["data"]] == [
            "Today briefing.",
            "Older briefing.",
        ]
        assert [row["summary"] for row in dated.json()["data"]] == ["Today briefing."]
        assert since.json()["meta"]["total"] == 1
        assert briefings_unauthenticated.status_code == 401
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.asyncio
async def test_risk_rankings_use_each_sites_latest_score() -> None:
    from datetime import UTC, datetime, timedelta

    from app.models.entities import RiskScore

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    now = datetime.now(UTC)
    async with factory() as session:
        sites = [
            Site(
                eia_plant_id=900 + index,
                name=name,
                latitude=30,
                longitude=-90,
                state="LA",
                county="Test",
                timezone="America/Chicago",
                source_release="test",
                source_url="test",
                source_metadata={},
                is_reference_location=True,
                ml_site_id=f"EIA-{900 + index}" if index < 2 else None,
                ml_model_version="v1" if index < 2 else None,
            )
            for index, name in enumerate(["Older high", "Newer high", "Unscored"])
        ]
        user = UserAccount(
            username="ranking-tester",
            password_hash=hash_password("testing-password"),
            role=UserRole.USER,
            status=UserStatus.ACTIVE,
        )
        session.add_all([*sites, user])
        await session.flush()

        def score(site: Site, value: float, minutes_ago: int, day: int) -> RiskScore:
            return RiskScore(
                site_id=site.id,
                score=value,
                generated_at=now - timedelta(minutes=minutes_ago),
                prediction_date=(now + timedelta(days=day)).date(),
                valid_for_seconds=86400,
                model_version="v1",
                score_source="model",
                contributing_factors={},
            )

        session.add_all(
            [
                # The first site's latest score is low even though an older one was high.
                score(sites[0], 9.0, 120, 0),
                score(sites[0], 2.0, 10, 1),
                score(sites[1], 1.0, 120, 0),
                score(sites[1], 6.0, 5, 1),
            ]
        )
        token, _, _, _ = await issue_token_pair(session, user, get_settings())
        await session.commit()

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/risk/rankings", headers={"Authorization": f"Bearer {token}"}
            )
        assert response.status_code == 200
        rows = response.json()["data"]
        assert [(row["site"]["name"], row["risk"] and row["risk"]["score"]) for row in rows] == [
            ("Newer high", 6.0),
            ("Older high", 2.0),
            ("Unscored", None),
        ]
        assert [row["status"] for row in rows] == ["available", "available", "unsupported"]
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
