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
            role=UserRole.CREW,
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
