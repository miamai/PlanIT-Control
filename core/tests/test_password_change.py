from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.database import get_session
from app.main import app
from app.models.entities import Base, UserAccount, UserRole, UserStatus
from app.services.auth import hash_password


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.ADMIN])
async def test_password_change_rotates_cookie_and_retains_role(role):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        session.add(
            UserAccount(
                username="password.tester",
                password_hash=hash_password("old-test-password"),
                role=role,
                status=UserStatus.ACTIVE,
            )
        )
        await session.commit()

    async def override():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            url = "/api/auth/me/password"
            assert (
                await client.patch(
                    url,
                    json={
                        "current_password": "old-test-password",
                        "new_password": "new-test-password",
                    },
                )
            ).status_code == 401
            logged = await client.post(
                "/api/auth/login",
                json={"username": "password.tester", "password": "old-test-password"},
            )
            cookie_name = get_settings().refresh_cookie_name
            old_cookie = logged.cookies[cookie_name]
            headers = {"Authorization": f"Bearer {logged.json()['access_token']}"}
            assert (
                await client.patch(
                    url,
                    headers=headers,
                    json={"current_password": "incorrect", "new_password": "new-test-password"},
                )
            ).status_code == 401
            assert (
                await client.patch(
                    url,
                    headers=headers,
                    json={"current_password": "old-test-password", "new_password": "short"},
                )
            ).status_code == 422
            assert (
                await client.patch(
                    url,
                    headers=headers,
                    json={
                        "current_password": "old-test-password",
                        "new_password": "old-test-password",
                    },
                )
            ).status_code == 422
            changed = await client.patch(
                url,
                headers=headers,
                json={"current_password": "old-test-password", "new_password": "new-test-password"},
            )
            assert changed.status_code == 200
            assert changed.json()["user"]["role"] == role.value
            assert changed.json()["expires_in"] == get_settings().access_token_minutes * 60
            replacement = changed.cookies[cookie_name]
            assert replacement != old_cookie
            cookie_header = changed.headers["set-cookie"].lower()
            for attribute in ("httponly", "samesite=lax", "path=/api/auth"):
                assert attribute in cookie_header
            client.cookies.clear()
            stale = await client.post(
                "/api/auth/refresh", headers={"Cookie": f"{cookie_name}={old_cookie}"}
            )
            assert stale.status_code == 401
            # Failed reuse of a password-revoked cookie must not revoke the new session.
            fresh = await client.post(
                "/api/auth/refresh", headers={"Cookie": f"{cookie_name}={replacement}"}
            )
            assert fresh.status_code == 200
            assert (
                await client.post(
                    "/api/auth/login",
                    json={"username": "password.tester", "password": "old-test-password"},
                )
            ).status_code == 401
            assert (
                await client.post(
                    "/api/auth/login",
                    json={"username": "password.tester", "password": "new-test-password"},
                )
            ).status_code == 200
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
