from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import get_session
from app.main import app
from app.models.entities import Base
from app.services.auth import hash_password

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is required")
CORE_DIR = Path(__file__).resolve().parents[1]


def run_alembic(revision: str) -> None:
    environment = os.environ.copy()
    environment["DATABASE_URL"] = TEST_DATABASE_URL
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=CORE_DIR,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


async def reset_application_schema(engine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


@pytest.mark.asyncio
async def test_existing_admin_is_usable_after_forced_password_column_removal() -> None:
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await reset_application_schema(engine)

        run_alembic("20261017_0002")
        password = "existing-admin-test-password"
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    INSERT INTO user_accounts
                        (id, username, password_hash, role, status, must_change_password)
                    VALUES
                        (gen_random_uuid(), :username, :password_hash, 'ADMIN', 'ACTIVE', true)
                    """
                ),
                {
                    "username": "existing.admin",
                    "password_hash": hash_password(password),
                },
            )

        run_alembic("head")
        async with engine.connect() as connection:
            column_count = await connection.scalar(
                text(
                    """
                    SELECT count(*)
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'user_accounts'
                      AND column_name = 'must_change_password'
                    """
                )
            )
        assert column_count == 0

        factory = async_sessionmaker(engine, expire_on_commit=False)

        async def override_session():
            async with factory() as session:
                yield session

        app.dependency_overrides[get_session] = override_session
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            login = await client.post(
                "/api/auth/login",
                json={"username": "existing.admin", "password": password},
            )
            assert login.status_code == 200
            assert "must_change_password" not in login.json()["user"]
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
            assert (await client.get("/api/auth/me", headers=headers)).status_code == 200
            assert (await client.get("/api/sites", headers=headers)).status_code == 200
    finally:
        app.dependency_overrides.clear()
        await reset_application_schema(engine)
        await engine.dispose()
