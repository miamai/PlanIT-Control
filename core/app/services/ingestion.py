from __future__ import annotations

from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.entities import (
    HazardObservation,
    ProviderRun,
    RiverStation,
    Site,
    SiteRiverStation,
)
from app.providers.base import EnvironmentalProvider
from app.providers.flood import USGSWaterProvider
from app.providers.soil import AntecedentRainfallSoilProvider
from app.providers.weather import NWSWeatherProvider
from app.providers.wildfire import FIRMSProvider
from app.schemas.domain import NormalizedObservation
from app.services.rules import evaluate_observation


async def store_observations(
    session: AsyncSession, observations: list[NormalizedObservation]
) -> int:
    written = 0
    for item in observations:
        if item.source == "usgs" and item.metadata.get("station_id"):
            station_values = {
                "station_id": item.metadata["station_id"],
                "name": item.metadata.get("station_name") or item.metadata["station_id"],
                "latitude": item.metadata["station_latitude"],
                "longitude": item.metadata["station_longitude"],
                "metadata_": {"source": "USGS"},
            }
            await session.execute(
                insert(RiverStation)
                .values(**station_values)
                .on_conflict_do_update(
                    index_elements=["station_id"],
                    set_={
                        "name": station_values["name"],
                        "latitude": station_values["latitude"],
                        "longitude": station_values["longitude"],
                    },
                )
            )
            await session.execute(
                insert(SiteRiverStation)
                .values(
                    site_id=item.site_id,
                    station_id=item.metadata["station_id"],
                    distance_miles=item.metadata["distance_miles"],
                )
                .on_conflict_do_update(
                    index_elements=["site_id", "station_id"],
                    set_={"distance_miles": item.metadata["distance_miles"]},
                )
            )
        values = item.model_dump(exclude={"metadata"})
        values["metadata_"] = item.metadata
        statement = (
            insert(HazardObservation)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=[
                    "site_id",
                    "source",
                    "source_event_id",
                    "metric_name",
                    "observed_at",
                ]
            )
            .returning(HazardObservation.id)
        )
        observation_id = await session.scalar(statement)
        if observation_id:
            written += 1
            observation = await session.scalar(
                select(HazardObservation).where(HazardObservation.id == observation_id)
            )
            await evaluate_observation(session, observation)
    return written


async def run_provider(
    session: AsyncSession,
    provider_name: str,
    settings: Settings,
    states: list[str] | None = None,
) -> ProviderRun:
    started = datetime.now(UTC)
    normalized_states = sorted({state.upper() for state in (states or [])})
    run = ProviderRun(
        provider=provider_name,
        started_at=started,
        status="running",
        scope={"states": normalized_states, "country": "US"},
    )
    session.add(run)
    await session.flush()
    try:
        site_query = select(Site)
        if normalized_states:
            site_query = site_query.where(Site.state.in_(normalized_states))
        sites = (await session.scalars(site_query)).all()
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            provider: EnvironmentalProvider
            if provider_name == "weather":
                provider = NWSWeatherProvider(client, settings.nws_user_agent)
                observations = await provider.fetch(sites)
            elif provider_name == "weather_alerts":
                provider = NWSWeatherProvider(client, settings.nws_user_agent)
                observations = await provider.fetch_alerts(sites)
            elif provider_name == "usgs":
                provider = USGSWaterProvider(client)
                observations = await provider.fetch(sites)
            elif provider_name == "wildfire":
                provider = FIRMSProvider(client, settings.nasa_firms_map_key)
                observations = await provider.fetch(sites)
            elif provider_name == "soil":
                provider = AntecedentRainfallSoilProvider(session)
                observations = await provider.fetch(sites)
            else:
                raise ValueError(f"Unknown provider: {provider_name}")
        run.records_written = await store_observations(session, observations)
        run.status = "success"
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)[:4000]
    run.completed_at = datetime.now(UTC)
    await session.commit()
    return run
