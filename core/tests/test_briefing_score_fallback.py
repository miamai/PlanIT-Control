from __future__ import annotations

import json
from datetime import UTC, date, datetime

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.models.entities import Base, RiskScore, SafetyBriefing, Site
from app.services.briefing import generate_due_briefings
from app.services.ml import MLClient


@pytest.mark.asyncio
async def test_failed_briefing_keeps_the_score_and_is_not_retried() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _advisory_lock(dbapi_connection, _record) -> None:
        dbapi_connection.create_function("pg_try_advisory_xact_lock", 1, lambda key: 1)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/briefing":
            return httpx.Response(500, json={"detail": "briefing failed"})
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "site_id": body["site_id"],
                "date": body["date"],
                "hazard_index": 1.9,
                "recommendation": "go",
                "sub_scores": {"flood": 0.8},
                "model_version": "v1",
            },
        )

    client = MLClient(Settings(ml_base_url="http://ml"), transport=httpx.MockTransport(handler))
    now = datetime(2026, 10, 17, 23, 0, tzinfo=UTC)  # 19:00 in New York
    async with factory() as session:
        session.add(
            Site(
                eia_plant_id=7954,
                name="Field Street",
                latitude=27.5,
                longitude=-80.3,
                state="FL",
                county="Test",
                timezone="America/New_York",
                source_release="test",
                source_url="test",
                source_metadata={},
                ml_site_id="EIA-7954",
                ml_model_version="v1",
            )
        )
        await session.commit()

        assert await generate_due_briefings(session, now, ml_client=client) == 1
        await session.commit()
        assert calls == ["/briefing", "/score"]
        risk = await session.scalar(select(RiskScore))
        assert (risk.prediction_date, risk.score, risk.score_source) == (
            date(2026, 10, 18),
            1.9,
            "ml_service",
        )
        briefing = await session.scalar(select(SafetyBriefing))
        details = briefing.hazard_details
        assert (details["generation_status"], details["risk_status"]) == ("fallback", "available")
        assert details["risk_score_id"] == str(risk.id)
        assert any("model's score" in warning for warning in details["warnings"])

        # A stored score ends the retries even though the briefing text was a fallback.
        calls.clear()
        assert await generate_due_briefings(session, now, ml_client=client) == 0
        assert calls == []
    await engine.dispose()
