from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.core.database import get_session
from app.main import app
from app.models.entities import (
    Base,
    HazardObservation,
    HazardType,
    QualityStatus,
    Site,
    UserAccount,
)
from app.services.auth import initialize_admin, verify_password


@pytest.mark.asyncio
async def test_initialized_admin_crud_and_state_feed() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        await initialize_admin(
            session,
            Settings(
                _env_file=None,
                initial_admin_username="provisioned.operator",
                initial_admin_password="test-only-initial-secret",
            ),
        )
        administrator = await session.scalar(
            select(UserAccount).where(UserAccount.username == "provisioned.operator")
        )
        assert administrator is not None
        admin_id = str(administrator.id)
        sites = []
        for plant_id, state in ((1, "LA"), (2, "TX")):
            site = Site(
                eia_plant_id=plant_id,
                name=f"{state} Plant",
                latitude=30,
                longitude=-90,
                state=state,
                county="Test",
                timezone="America/Chicago",
                source_release="test",
                source_url="test",
                source_metadata={},
                is_reference_location=True,
            )
            session.add(site)
            sites.append(site)
        await session.flush()
        for site in sites:
            session.add(
                HazardObservation(
                    site_id=site.id,
                    hazard_type=HazardType.WEATHER,
                    source="test",
                    source_event_id=f"weather-{site.state}",
                    observed_at=datetime.now(UTC),
                    metric_name="forecast_temperature",
                    numeric_value=80,
                    unit="F",
                    metadata_={},
                    quality_status=QualityStatus.PROVISIONAL,
                    is_estimated=False,
                )
            )
            await session.flush()
        await session.commit()

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            login = await client.post(
                "/api/auth/login",
                json={
                    "username": "provisioned.operator",
                    "password": "test-only-initial-secret",
                },
            )
            assert login.status_code == 200
            initial_token = login.json()["access_token"]
            initial_headers = {"Authorization": f"Bearer {initial_token}"}
            assert (await client.get("/api/sites", headers=initial_headers)).status_code == 200

            refreshed = await client.post("/api/auth/refresh")
            assert refreshed.status_code == 200
            token = refreshed.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            feed = await client.get("/api/sites/lightning?state=LA&state=TX", headers=headers)
            assert feed.status_code == 200
            assert feed.json()["meta"]["states"] == ["LA", "TX"]
            assert feed.json()["meta"]["total"] == 0

            created = await client.post(
                "/api/admin/users",
                headers=headers,
                json={
                    "username": "user.one",
                    "password": "temporary-password",
                    "role": "user",
                },
            )
            assert created.status_code == 201
            assert "must_change_password" not in created.json()["data"]
            regular_id = created.json()["data"]["id"]
            regular_login = await client.post(
                "/api/auth/login",
                json={"username": "user.one", "password": "temporary-password"},
            )
            assert regular_login.status_code == 200
            regular_headers = {"Authorization": f"Bearer {regular_login.json()['access_token']}"}
            assert (await client.get("/api/sites", headers=regular_headers)).status_code == 200

            reset = await client.patch(
                f"/api/admin/users/{regular_id}",
                headers=headers,
                json={"password": "administrator-reset-password"},
            )
            assert reset.status_code == 200
            assert (
                await client.post(
                    "/api/auth/login",
                    json={"username": "user.one", "password": "temporary-password"},
                )
            ).status_code == 401
            reset_login = await client.post(
                "/api/auth/login",
                json={"username": "user.one", "password": "administrator-reset-password"},
            )
            assert reset_login.status_code == 200
            reset_headers = {"Authorization": f"Bearer {reset_login.json()['access_token']}"}
            assert (await client.get("/api/sites", headers=reset_headers)).status_code == 200

            demote_last_admin = await client.patch(
                f"/api/admin/users/{admin_id}", headers=headers, json={"role": "user"}
            )
            assert demote_last_admin.status_code == 409
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.asyncio
async def test_initial_admin_requires_secrets_and_an_empty_user_table() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        with pytest.raises(ValueError, match="INITIAL_ADMIN_USERNAME"):
            await initialize_admin(session, Settings(_env_file=None))
        with pytest.raises(ValueError, match="INITIAL_ADMIN_USERNAME"):
            await initialize_admin(
                session,
                Settings(
                    _env_file=None,
                    initial_admin_password="password-without-a-username",
                ),
            )
        with pytest.raises(ValueError, match="INITIAL_ADMIN_PASSWORD"):
            await initialize_admin(
                session,
                Settings(
                    _env_file=None,
                    initial_admin_username="username.without.password",
                ),
            )
        with pytest.raises(ValueError, match="invalid format"):
            await initialize_admin(
                session,
                Settings(
                    _env_file=None,
                    initial_admin_username="invalid username",
                    initial_admin_password="valid-test-password",
                ),
            )
        with pytest.raises(ValueError, match="8 to 256"):
            await initialize_admin(
                session,
                Settings(
                    _env_file=None,
                    initial_admin_username="valid.username",
                    initial_admin_password="short",
                ),
            )
        assert await session.scalar(select(func.count()).select_from(UserAccount)) == 0
        settings = Settings(
            _env_file=None,
            initial_admin_username="first.operator",
            initial_admin_password="test-only-provisioning-secret",
        )
        user = await initialize_admin(session, settings)
        assert user.role.value == "admin"
        assert verify_password("test-only-provisioning-secret", user.password_hash)
        with pytest.raises(ValueError, match="no user accounts exist"):
            await initialize_admin(
                session,
                Settings(
                    _env_file=None,
                    initial_admin_username="second.operator",
                    initial_admin_password="another-test-only-secret",
                ),
            )
    await engine.dispose()
