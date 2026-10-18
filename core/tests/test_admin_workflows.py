from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.auth import Principal, get_principal
from app.core.database import get_session
from app.main import app
from app.models.entities import (
    Alert,
    AlertStatus,
    AlertTransition,
    Base,
    CrewReport,
    HazardObservation,
    HazardType,
    LightningSiteState,
    Severity,
    Site,
)


@pytest_asyncio.fixture
async def workflow():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        site = Site(
            eia_plant_id=987,
            name="Workflow plant",
            latitude=30,
            longitude=-90,
            state="LA",
            timezone="UTC",
            source_release="test",
            source_url="test",
            source_metadata={},
        )
        session.add(site)
        await session.commit()
        site_id = str(site.id)

    async def session_override():
        async with factory() as session:
            yield session

    principal = Principal(uuid.uuid4(), "crew", "user", {})

    async def principal_override():
        return principal

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_principal] = principal_override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:

            def role(value):
                nonlocal principal
                principal = Principal(
                    uuid.uuid4(), "crew" if value == "user" else "reviewer", value, {}
                )

            yield client, factory, site_id, role
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def create_report(client, site_id, hazard="soil"):
    response = await client.post(
        "/api/reports",
        json={
            "site_id": site_id,
            "hazard_type": hazard,
            "description": "Crew field report",
            "latitude": 30,
            "longitude": -90,
        },
    )
    assert response.status_code == 201
    return response.json()["data"]


async def test_report_admin_crud_does_not_expand_user_or_owner_permissions(workflow):
    client, factory, site_id, role = workflow
    original = await create_report(client, site_id)
    url = f"/api/reports/{original['id']}"
    assert (await client.get("/api/reports")).status_code == 403
    assert (await client.patch(url, json={"description": "Owner edit"})).status_code == 403
    assert (await client.delete(url)).status_code == 403
    role("admin")
    for body in ({"description": "  "}, {"description": "New text", "latitude": 0}, {}):
        assert (await client.patch(url, json=body)).status_code == 422
    edited = await client.patch(url, json={"description": "  Corrected ground condition  "})
    assert edited.status_code == 200
    data = edited.json()["data"]
    assert data["description"] == "Corrected ground condition"
    for key in (
        "site_id",
        "hazard_type",
        "latitude",
        "longitude",
        "reported_at",
        "reporter_subject",
    ):
        assert data[key] == original[key]
    assert (await client.get("/api/reports")).json()["data"][0]["description"] == data[
        "description"
    ]
    assert (await client.delete(url)).status_code == 204
    assert (await client.get("/api/reports")).json()["data"] == []
    assert (await client.delete(url)).status_code == 404
    assert (await client.patch(url, json={"description": "Missing report"})).status_code == 404


async def test_wildlife_edit_delete_syncs_only_derived_observations_and_alerts(workflow):
    client, factory, site_id, role = workflow
    report = await create_report(client, site_id, "wildlife")
    second = await create_report(client, site_id, "wildlife")
    role("admin")
    url = f"/api/reports/{report['id']}"
    assert (
        await client.patch(url, json={"description": "Corrected wildlife sighting"})
    ).status_code == 200
    async with factory() as session:
        observation = await session.scalar(
            select(HazardObservation).where(HazardObservation.source_event_id == report["id"])
        )
        assert observation.metadata_["description"] == "Corrected wildlife sighting"
        alert_id = (
            await session.scalar(
                select(Alert).where(Alert.source_reference == f"observation:{observation.id}")
            )
        ).id
        linked = await session.get(Alert, alert_id)
        assert linked.details["source_metadata"]["description"] == "Corrected wildlife sighting"
    assert (await client.delete(url)).status_code == 204
    async with factory() as session:
        assert await session.get(CrewReport, uuid.UUID(report["id"])) is None
        assert (
            await session.scalar(
                select(HazardObservation).where(HazardObservation.source_event_id == report["id"])
            )
            is None
        )
        assert (await session.get(Alert, alert_id)).status == AlertStatus.RESOLVED
        transitions = (
            await session.scalars(
                select(AlertTransition).where(AlertTransition.alert_id == alert_id)
            )
        ).all()
        assert any("deleted by reviewer" in transition.reason for transition in transitions)
        assert (
            await session.scalar(
                select(HazardObservation).where(HazardObservation.source_event_id == second["id"])
            )
            is not None
        )
        assert (
            len(
                (
                    await session.scalars(select(Alert).where(Alert.status == AlertStatus.ACTIVE))
                ).all()
            )
            == 1
        )


@pytest.mark.parametrize(
    "status,minutes,expected",
    [
        (AlertStatus.ACTIVE, 10, 409),
        (AlertStatus.ACTIVE, -10, 409),
        (AlertStatus.ALL_CLEAR_ELIGIBLE, 10, 409),
        (AlertStatus.ALL_CLEAR_ELIGIBLE, -10, 200),
    ],
)
async def test_lightning_signoff_requires_server_eligibility_and_elapsed_countdown(
    workflow, status, minutes, expected
):
    client, factory, site_id, role = workflow
    now = datetime.now(UTC)
    async with factory() as session:
        alert = Alert(
            site_id=uuid.UUID(site_id),
            hazard_type=HazardType.LIGHTNING,
            action_code="STOP_WORK",
            severity=Severity.CRITICAL,
            status=status,
            title="Lightning",
            message="Strike",
            recommended_action="Stop exposed work",
            triggered_at=now - timedelta(minutes=40),
            expires_at=now + timedelta(minutes=minutes),
            details={},
        )
        session.add(alert)
        await session.flush()
        session.add(
            LightningSiteState(
                site_id=uuid.UUID(site_id),
                alert_id=alert.id,
                latest_strike_id="test",
                latest_qualifying_strike_at=now - timedelta(minutes=40),
                all_clear_eligible_at=now + timedelta(minutes=minutes),
            )
        )
        await session.commit()
        alert_id = alert.id
    url = f"/api/alerts/{alert_id}"
    body = {"status": "RESOLVED", "reason": "Conditions reviewed"}
    assert (await client.patch(url, json=body)).status_code == 403
    role("admin")
    response = await client.patch(url, json=body)
    assert response.status_code == expected
    if expected == 200:
        assert response.json()["data"]["resolved_at"] is not None
        # A later qualifying strike makes the previously displayed sign-off
        # obsolete, even if an old expires_at/status remains in a client.
        async with factory() as session:
            state = await session.get(LightningSiteState, uuid.UUID(site_id))
            state.all_clear_eligible_at = datetime.now(UTC) + timedelta(minutes=30)
            stored = await session.get(Alert, alert_id)
            stored.status = AlertStatus.ALL_CLEAR_ELIGIBLE
            await session.commit()
        assert (await client.patch(url, json=body)).status_code == 409
        async with factory() as session:
            transition = await session.scalar(
                select(AlertTransition).where(AlertTransition.alert_id == alert_id)
            )
            assert transition.reason == "Conditions reviewed (by reviewer)"
    else:
        async with factory() as session:
            assert (await session.get(Alert, alert_id)).status == status
