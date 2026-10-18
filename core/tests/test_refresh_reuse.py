from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.database import get_session
from app.main import app
from app.models.entities import Base, RefreshSession, UserAccount, UserRole, UserStatus
from app.services.auth import hash_password

COOKIE = get_settings().refresh_cookie_name
PASSWORD = "testing-password"


@pytest.fixture
async def stack():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        session.add(
            UserAccount(
                username="tester",
                password_hash=hash_password(PASSWORD),
                role=UserRole.USER,
                status=UserStatus.ACTIVE,
            )
        )
        await session.commit()

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, factory
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/api/auth/login", json={"username": "tester", "password": PASSWORD}
    )
    assert response.status_code == 200
    return response.cookies[COOKIE]


async def _refresh(client: AsyncClient, token: str):
    # Present exactly this cookie, as a browser holding a stale jar would.
    client.cookies.clear()
    return await client.post("/api/auth/refresh", headers={"Cookie": f"{COOKIE}={token}"})


def _session_id(token: str) -> uuid.UUID:
    return uuid.UUID(jwt.decode(token, options={"verify_signature": False})["jti"])


async def _backdate_rotation(factory, token: str, seconds: int) -> None:
    async with factory() as session:
        await session.execute(
            update(RefreshSession)
            .where(RefreshSession.id == _session_id(token))
            .values(revoked_at=datetime.now(UTC) - timedelta(seconds=seconds))
        )
        await session.commit()


@pytest.mark.asyncio
async def test_rotated_token_presented_again_within_grace_gets_new_session(stack) -> None:
    """A reload that aborts the refresh response, or a second tab sending the
    same cookie, must not sign the user out anywhere."""
    client, _ = stack
    other_device = await _login(client)
    original = await _login(client)

    first = await _refresh(client, original)
    assert first.status_code == 200
    replacement = first.cookies[COOKIE]

    stale = await _refresh(client, original)
    assert stale.status_code == 200
    sibling = stale.cookies[COOKIE]
    assert sibling not in (original, replacement)
    assert stale.json()["access_token"]

    # The replacement may have been stored by the other tab; it stays usable,
    # and so does a further rotation of it followed by another stale request.
    rotated = await _refresh(client, replacement)
    assert rotated.status_code == 200
    assert (await _refresh(client, original)).status_code == 200
    assert (await _refresh(client, sibling)).status_code == 200
    assert (await _refresh(client, other_device)).status_code == 200


@pytest.mark.asyncio
async def test_rotated_token_replayed_after_grace_revokes_every_session(stack) -> None:
    client, factory = stack
    other_device = await _login(client)
    original = await _login(client)
    replacement = (await _refresh(client, original)).cookies[COOKIE]

    grace = get_settings().refresh_reuse_grace_seconds
    await _backdate_rotation(factory, original, grace + 1)

    replay = await _refresh(client, original)
    assert replay.status_code == 401
    assert COOKIE not in replay.cookies
    assert (await _refresh(client, replacement)).status_code == 401
    assert (await _refresh(client, other_device)).status_code == 401


@pytest.mark.asyncio
async def test_logged_out_token_replayed_revokes_every_session(stack) -> None:
    client, _ = stack
    other_device = await _login(client)
    login = await client.post("/api/auth/login", json={"username": "tester", "password": PASSWORD})
    token = login.cookies[COOKIE]
    logout = await client.post(
        "/api/auth/logout",
        headers={
            "Authorization": f"Bearer {login.json()['access_token']}",
            "Cookie": f"{COOKIE}={token}",
        },
    )
    assert logout.status_code == 204

    assert (await _refresh(client, token)).status_code == 401
    assert (await _refresh(client, other_device)).status_code == 401
