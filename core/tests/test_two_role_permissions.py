from __future__ import annotations

from datetime import UTC, datetime

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.database import get_session
from app.main import app
from app.models.entities import (
    Alert,
    AlertStatus,
    Base,
    HazardType,
    Severity,
    Site,
    UserAccount,
    UserRole,
    UserStatus,
)
from app.services.auth import hash_password, issue_token_pair


@pytest.mark.asyncio
async def test_user_and_admin_permissions_and_legacy_token_claims() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    settings = get_settings()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        site = Site(
            eia_plant_id=123,
            name="Role test",
            latitude=30,
            longitude=-90,
            state="LA",
            timezone="UTC",
            source_release="test",
            source_url="test",
            source_metadata={},
        )
        regular = UserAccount(
            username="role.user",
            password_hash=hash_password("test-only-password"),
            role=UserRole.USER,
            status=UserStatus.ACTIVE,
        )
        administrator = UserAccount(
            username="role.admin",
            password_hash=hash_password("test-only-password"),
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
        )
        session.add_all([site, regular, administrator])
        await session.flush()
        alert = Alert(
            site_id=site.id,
            hazard_type=HazardType.HEAT,
            severity=Severity.HIGH,
            status=AlertStatus.ACTIVE,
            title="Test heat",
            message="Test",
            recommended_action="Test action",
            triggered_at=datetime.now(UTC),
            details={},
        )
        session.add(alert)
        user_token, _, _, _ = await issue_token_pair(session, regular, settings)
        admin_token, _, _, _ = await issue_token_pair(session, administrator, settings)
        await session.commit()
        site_id, alert_id = str(site.id), str(alert.id)

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            user_headers = {"Authorization": f"Bearer {user_token}"}
            admin_headers = {"Authorization": f"Bearer {admin_token}"}
            assert (await client.get("/api/sites", headers=user_headers)).status_code == 200
            assert (
                await client.post(
                    "/api/reports",
                    headers=user_headers,
                    json={
                        "site_id": site_id,
                        "hazard_type": "soil",
                        "description": "Test field condition",
                        "latitude": 30,
                        "longitude": -90,
                    },
                )
            ).status_code == 201
            assert (await client.get("/api/reports", headers=user_headers)).status_code == 403
            assert (
                await client.patch(
                    f"/api/alerts/{alert_id}",
                    headers=user_headers,
                    json={"status": "ACKNOWLEDGED", "reason": "Test acknowledgement"},
                )
            ).status_code == 403
            assert (await client.get("/api/admin/users", headers=user_headers)).status_code == 403
            assert (await client.get("/api/admin/system", headers=user_headers)).status_code == 403
            assert (
                await client.post("/api/admin/ingestion/weather", headers=user_headers)
            ).status_code == 403
            assert (await client.get("/api/reports", headers=admin_headers)).status_code == 200
            assert (
                await client.patch(
                    f"/api/alerts/{alert_id}",
                    headers=admin_headers,
                    json={"status": "ACKNOWLEDGED", "reason": "Admin reviewed"},
                )
            ).status_code == 200
            assert (
                await client.patch(
                    f"/api/alerts/{alert_id}",
                    headers=admin_headers,
                    json={"status": "RESOLVED", "reason": "Admin resolved"},
                )
            ).status_code == 200
            for role in ("crew", "supervisor"):
                assert (
                    await client.post(
                        "/api/admin/users",
                        headers=admin_headers,
                        json={
                            "username": f"invalid.{role}",
                            "password": "test-only-password",
                            "role": role,
                        },
                    )
                ).status_code == 422
                assert (
                    await client.get(f"/api/admin/users?role={role}", headers=admin_headers)
                ).status_code == 422
            peer = await client.post(
                "/api/admin/users",
                headers=admin_headers,
                json={"username": "peer.admin", "password": "test-only-password", "role": "admin"},
            )
            assert peer.status_code == 201
            peer_id = peer.json()["data"]["id"]
            assert (
                await client.patch(
                    f"/api/admin/users/{peer_id}", headers=admin_headers, json={"role": "user"}
                )
            ).json()["data"]["role"] == "user"
            assert (
                await client.delete(f"/api/admin/users/{peer_id}", headers=admin_headers)
            ).status_code == 204

            # The account's current database role controls access, never a stale JWT claim.
            for token, legacy_claim, expected in (
                (admin_token, "supervisor", 200),
                (user_token, "admin", 403),
            ):
                claims = jwt.decode(
                    token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
                )
                claims["role"] = legacy_claim
                stale_token = jwt.encode(
                    claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
                )
                assert (
                    await client.get(
                        "/api/admin/users", headers={"Authorization": f"Bearer {stale_token}"}
                    )
                ).status_code == expected
            refresh = await client.post(
                "/api/auth/login", json={"username": "role.user", "password": "test-only-password"}
            )
            assert refresh.json()["user"]["role"] == "user"
            assert (await client.post("/api/auth/refresh")).json()["user"]["role"] == "user"
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
