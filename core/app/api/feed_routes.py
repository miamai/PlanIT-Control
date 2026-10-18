from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import UserPrincipal
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.models.entities import HazardObservation, HazardType, ProviderRun, Site
from app.schemas.domain import (
    Envelope,
    FeedMeta,
    ObservationRead,
    SiteObservationRead,
    SiteRead,
)
from app.services.hazard_severity import assess_observation

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_session)]


def _observation_read(observation: HazardObservation, settings: Settings) -> ObservationRead:
    assessment = assess_observation(observation, settings)
    return ObservationRead.model_validate(observation).model_copy(
        update={"severity": assessment.severity, "severity_basis": assessment.basis}
    )


FEEDS = {
    "lightning": ({HazardType.LIGHTNING}, ("lightning",), "stored-fixture"),
}


def _normalize_states(states: list[str]) -> list[str]:
    normalized: list[str] = []
    for state in states:
        value = state.strip().upper()
        if len(value) != 2 or not value.isalpha():
            raise HTTPException(status_code=422, detail=f"Invalid US state code: {state}")
        if value not in normalized:
            normalized.append(value)
    return normalized


async def _feed(
    name: str,
    session: AsyncSession,
    states: list[str],
    since: datetime | None,
    limit: int,
    offset: int,
    settings: Settings,
) -> Envelope[list[SiteObservationRead]]:
    hazard_types, providers, data_mode = FEEDS[name]
    normalized_states = _normalize_states(states)
    filters = [HazardObservation.hazard_type.in_(hazard_types)]
    if normalized_states:
        filters.append(Site.state.in_(normalized_states))
    if since:
        filters.append(HazardObservation.observed_at >= since)
    joined = HazardObservation.__table__.join(Site, HazardObservation.site_id == Site.id)
    total = await session.scalar(select(func.count()).select_from(joined).where(*filters))
    rows = (
        await session.execute(
            select(HazardObservation, Site)
            .join(Site, HazardObservation.site_id == Site.id)
            .where(*filters)
            .order_by(HazardObservation.observed_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    last_success = await session.scalar(
        select(func.max(ProviderRun.completed_at)).where(
            ProviderRun.provider.in_(providers), ProviderRun.status == "success"
        )
    )
    last_status = await session.scalar(
        select(ProviderRun.status)
        .where(ProviderRun.provider.in_(providers))
        .order_by(ProviderRun.started_at.desc())
        .limit(1)
    )
    return Envelope(
        data=[
            SiteObservationRead(
                site=SiteRead.model_validate(site),
                observation=_observation_read(observation, settings),
            )
            for observation, site in rows
        ],
        meta=FeedMeta(
            limit=limit,
            offset=offset,
            total=total or 0,
            states=normalized_states,
            data_mode=data_mode,
            last_successful_ingestion=last_success,
            last_run_status=last_status,
        ),
    )


def feed_endpoint(name: str):
    async def endpoint(
        _: UserPrincipal,
        session: DbSession,
        state: Annotated[list[str] | None, Query()] = None,
        since: datetime | None = None,
        limit: int = Query(100, ge=1, le=500),
        offset: int = Query(0, ge=0),
        settings: Settings = Depends(get_settings),
    ) -> Envelope[list[SiteObservationRead]]:
        return await _feed(name, session, state or [], since, limit, offset, settings)

    endpoint.__name__ = f"{name}_feed"
    return endpoint


for feed_name in FEEDS:
    router.add_api_route(
        f"/api/sites/{feed_name}",
        feed_endpoint(feed_name),
        methods=["GET"],
        response_model=Envelope[list[SiteObservationRead]],
        tags=["hazard-feeds"],
        summary=f"Stored {feed_name} observations across US sites",
    )
