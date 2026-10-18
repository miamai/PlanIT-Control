from __future__ import annotations

import base64
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.capture_routes import get_ml_client
from app.core.config import get_settings
from app.core.database import get_session
from app.main import app
from app.models.entities import (
    Base,
    CaptureFrame,
    CrewReport,
    Site,
    UserAccount,
    UserRole,
    UserStatus,
)
from app.services.auth import hash_password, issue_token_pair
from app.services.ml import MLCaptureChecklists, MLObservation

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x01" * 64).decode()
CHECKLISTS = {
    "identify": {"id": "identify", "instruction": "Point at it.", "frames": 1},
    "hazards": {
        "flood": [
            {"id": "extent", "instruction": "Step back.", "frames": 1},
            {"id": "depth", "instruction": "Frame a post.", "frames": 1},
            {"id": "flow", "instruction": "Hold steady.", "frames": 2},
            {"id": "source", "instruction": "Turn uphill.", "frames": 1},
        ]
    },
}


def observation(item: str, satisfied: bool = True, **extra: Any) -> dict[str, Any]:
    return {
        "item": item,
        "satisfied": satisfied,
        "observation": {},
        "text": None,
        "hint": None if satisfied else "not_visible",
        "hint_text": None if satisfied else "It isn't visible in this shot.",
        "danger": None,
        "hazard_guess": None,
        "confidence": None,
        "source": "fake",
        **extra,
    }


class FakeML:
    def __init__(self, *observations: dict[str, Any]):
        self.observations = list(observations)
        self.calls: list[tuple[str | None, str, int, float | None]] = []

    async def capture_checklists(self) -> MLCaptureChecklists:
        return MLCaptureChecklists.model_validate(CHECKLISTS)

    async def observe(
        self, hazard: str | None, item: str, images: list[str], heading_deg: float | None
    ) -> MLObservation:
        self.calls.append((hazard, item, len(images), heading_deg))
        return MLObservation.model_validate(self.observations.pop(0))


@asynccontextmanager
async def harness(ml: FakeML | None) -> AsyncIterator[tuple[AsyncClient, dict, dict, Any, Any]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with factory() as session:
        site = Site(
            eia_plant_id=321,
            name="Capture Plant",
            latitude=30,
            longitude=-90,
            state="LA",
            timezone="America/Chicago",
            source_release="test",
            source_url="test",
            source_metadata={},
        )
        users = [
            UserAccount(
                username=name,
                password_hash=hash_password("test-only-password"),
                role=UserRole.USER,
                status=UserStatus.ACTIVE,
            )
            for name in ("crew.one", "crew.two")
        ]
        session.add_all([site, *users])
        await session.flush()
        tokens = [(await issue_token_pair(session, u, get_settings()))[0] for u in users]
        await session.commit()

    async def override_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    if ml is not None:
        app.dependency_overrides[get_ml_client] = lambda: ml
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield (
                client,
                {"Authorization": f"Bearer {tokens[0]}"},
                {"Authorization": f"Bearer {tokens[1]}"},
                site.id,
                factory,
            )
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def frame(item: str, count: int = 1, heading: float | None = None) -> dict[str, Any]:
    return {"item": item, "images": [JPEG] * count, "latitude": 30.01, "longitude": -90.01,
            "heading_deg": heading}  # fmt: skip


@pytest.mark.asyncio
async def test_guided_flood_report_end_to_end() -> None:
    ml = FakeML(
        observation("identify", text="Looks like flooding", hazard_guess="flood", confidence=0.9),
        observation("extent", text="Water covers the full width of the road"),
        observation("flow", satisfied=False),
        observation("flow", text="Water is moving, flowing east", observation={"moving": True}),
        observation("source", text="Water is coming from a culvert that looks blocked"),
    )
    async with harness(ml) as (client, crew, other, site_id, factory):
        start = await client.post(
            "/api/captures",
            json={"site_id": str(site_id), "latitude": 30.0, "longitude": -90.0},
            headers=crew,
        )
        assert start.status_code == 201
        capture = start.json()["data"]
        assert capture["next_step"]["item"] == "identify"
        base = f"/api/captures/{capture['id']}"

        identified = (
            await client.post(f"{base}/frames", json=frame("identify"), headers=crew)
        ).json()
        assert identified["data"]["feedback"]["hazard_guess"] == "flood"
        assert identified["data"]["session"]["next_step"]["item"] == "identify"

        chosen = await client.post(f"{base}/hazard", json={"hazard_type": "flood"}, headers=crew)
        assert chosen.json()["data"]["guided"] is True
        assert chosen.json()["data"]["next_step"]["item"] == "extent"

        await client.post(f"{base}/frames", json=frame("extent"), headers=crew)
        skipped = await client.post(f"{base}/skip", json={"item": "depth"}, headers=crew)
        assert skipped.json()["data"]["next_step"]["item"] == "flow"

        one_photo = await client.post(f"{base}/frames", json=frame("flow"), headers=crew)
        assert one_photo.status_code == 422
        retake = (
            await client.post(f"{base}/frames", json=frame("flow", 2, 90), headers=crew)
        ).json()
        assert retake["data"]["feedback"]["hint"] == "It isn't visible in this shot."
        assert retake["data"]["session"]["next_step"]["item"] == "flow"
        await client.post(f"{base}/frames", json=frame("flow", 2, 90), headers=crew)
        done = (await client.post(f"{base}/frames", json=frame("source"), headers=crew)).json()
        session = done["data"]["session"]
        assert session["next_step"] is None
        assert [s["status"] for s in session["checklist"]] == ["done", "skipped", "done", "done"]
        assert session["draft"] == (
            "Water covers the full width of the road. Water is moving, flowing east. "
            "Water is coming from a culvert that looks blocked."
        )
        assert ml.calls[3] == ("flood", "flow", 2, 90.0)

        assert (
            await client.post(f"{base}/skip", json={"item": "x"}, headers=other)
        ).status_code == 404
        sent = await client.post(
            f"{base}/submit", json={"description": session["draft"]}, headers=crew
        )
        assert sent.status_code == 201
        report = sent.json()["data"]
        assert report["hazard_type"] == "flood"
        assert report["image_reference"] == base
        steps = {s["item"]: s for s in report["image_metadata"]["steps"]}
        assert steps["depth"]["status"] == "skipped"
        assert len(steps["flow"]["frame_ids"]) == 2
        again = await client.post(f"{base}/submit", json={"description": "again"}, headers=crew)
        assert again.status_code == 409

        # Only photos that answered a step are kept: identify, extent, two for flow, source.
        async with factory() as db:
            assert await db.scalar(select(func.count()).select_from(CaptureFrame)) == 5
        photo = await client.get(f"{base}/frames/{steps['extent']['frame_ids'][0]}", headers=crew)
        assert photo.status_code == 200
        assert photo.headers["content-type"] == "image/jpeg"
        assert photo.content.startswith(b"\xff\xd8\xff")
        hidden = await client.get(f"{base}/frames/{steps['extent']['frame_ids'][0]}", headers=other)
        assert hidden.status_code == 404


@pytest.mark.asyncio
async def test_safety_stop_files_the_report_immediately() -> None:
    danger = {
        "code": "rising_water",
        "hazard": "flood",
        "instruction": "Move to higher ground now.",
        "summary": "water rising near the crew",
    }
    ml = FakeML(observation("identify", satisfied=False, danger=danger))
    async with harness(ml) as (client, crew, _, site_id, factory):
        start = await client.post(
            "/api/captures",
            json={"site_id": str(site_id), "latitude": 30.0, "longitude": -90.0},
            headers=crew,
        )
        base = f"/api/captures/{start.json()['data']['id']}"
        result = (await client.post(f"{base}/frames", json=frame("identify"), headers=crew)).json()
        session = result["data"]["session"]
        assert session["status"] == "stopped"
        assert session["next_step"] is None
        assert session["danger"]["instruction"] == "Move to higher ground now."
        assert session["report_id"]
        async with factory() as db:
            report = await db.scalar(select(CrewReport))
        assert report.hazard_type.value == "flood"
        assert report.description.startswith("Safety stop during a guided photo report")
        blocked = await client.post(f"{base}/frames", json=frame("identify"), headers=crew)
        assert blocked.status_code == 409


@pytest.mark.asyncio
async def test_steps_must_follow_the_checklist() -> None:
    ml = FakeML(observation("identify", text="Looks like flooding", hazard_guess="flood"))
    async with harness(ml) as (client, crew, _, site_id, _factory):
        far = await client.post(
            "/api/captures",
            json={"site_id": str(site_id), "latitude": 45.0, "longitude": -70.0},
            headers=crew,
        )
        assert far.status_code == 422
        start = await client.post(
            "/api/captures",
            json={"site_id": str(site_id), "latitude": 30.0, "longitude": -90.0},
            headers=crew,
        )
        base = f"/api/captures/{start.json()['data']['id']}"
        early = await client.post(f"{base}/frames", json=frame("extent"), headers=crew)
        assert early.status_code == 409
        assert (
            await client.post(f"{base}/skip", json={"item": "identify"}, headers=crew)
        ).status_code == 409
        not_image = frame("identify") | {"images": [base64.b64encode(b"GIF89a" * 4).decode()]}
        assert (
            await client.post(f"{base}/frames", json=not_image, headers=crew)
        ).status_code == 422
        unsent = await client.post(f"{base}/submit", json={"description": "Water"}, headers=crew)
        assert unsent.status_code == 409

        await client.post(f"{base}/frames", json=frame("identify"), headers=crew)
        wildfire = await client.post(
            f"{base}/hazard", json={"hazard_type": "wildfire"}, headers=crew
        )
        assert wildfire.json()["data"]["guided"] is False
        assert wildfire.json()["data"]["next_step"] is None
        flood = await client.post(f"{base}/hazard", json={"hazard_type": "flood"}, headers=crew)
        assert flood.json()["data"]["next_step"]["item"] == "extent"
        await client.post(f"{base}/skip", json={"item": "extent"}, headers=crew)
        locked = await client.post(f"{base}/hazard", json={"hazard_type": "soil"}, headers=crew)
        assert locked.status_code == 409


@pytest.mark.asyncio
async def test_capture_needs_the_ml_service() -> None:
    disabled = get_settings().model_copy(update={"ml_enabled": False})
    app.dependency_overrides[get_settings] = lambda: disabled
    try:
        async with harness(None) as (client, crew, _, site_id, _factory):
            response = await client.post(
                "/api/captures",
                json={"site_id": str(site_id), "latitude": 30.0, "longitude": -90.0},
                headers=crew,
            )
        assert response.status_code == 503
    finally:
        app.dependency_overrides.clear()
