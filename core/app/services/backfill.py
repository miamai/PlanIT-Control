from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import RiskScore, Site
from app.providers.weather import NWSWeatherProvider
from app.services.briefing import _valid_seconds
from app.services.ingestion import store_observations
from app.services.ml import MLClient

# RiskScore.score_source for past days scored after the fact from observed weather, not forecast
# ahead. They fill the hazard index history only and are never a site's current score.
BACKFILL_SCORE_SOURCE = "ml_backfill"
MAX_SCORE_DAYS = 14  # the ML service rejects dates more than ~2 weeks back
MAX_WEATHER_HOURS = 7 * 24  # NWS keeps about a week of station readings


@dataclass
class BackfillResult:
    stored: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)


async def backfill_risk_scores(
    session: AsyncSession,
    client: MLClient,
    sites: Sequence[Site],
    days: int = MAX_SCORE_DAYS,
    now: datetime | None = None,
) -> BackfillResult:
    """Score each of the last `days` site-local days, today included, that has no score yet."""
    if not 1 <= days <= MAX_SCORE_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_SCORE_DAYS}")
    now = now or datetime.now(UTC)
    result = BackfillResult()
    for site in sites:
        if not site.ml_supported:
            continue
        today = now.astimezone(ZoneInfo(site.timezone)).date()
        dates = [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
        already_scored = set(
            (
                await session.scalars(
                    select(RiskScore.prediction_date).where(
                        RiskScore.site_id == site.id,
                        RiskScore.model_version == site.ml_model_version,
                        RiskScore.prediction_date.in_(dates),
                    )
                )
            ).all()
        )
        for prediction_date in dates:
            if prediction_date in already_scored:
                result.skipped += 1
                continue
            try:
                risk = await client.score(site, prediction_date)
            except Exception as exc:  # noqa: BLE001 - one failed day must not stop the rest
                result.failed.append(f"{site.name} {prediction_date}: {exc}")
                continue
            session.add(
                RiskScore(
                    site_id=site.id,
                    score=risk.hazard_index,
                    generated_at=now,
                    prediction_date=prediction_date,
                    valid_for_seconds=_valid_seconds(site, prediction_date, now),
                    model_version=risk.model_version,
                    score_source=BACKFILL_SCORE_SOURCE,
                    contributing_factors={**risk.contributing_factors(), "backfilled": True},
                )
            )
            result.stored += 1
        await session.commit()
    return result


async def backfill_weather(
    session: AsyncSession,
    provider: NWSWeatherProvider,
    sites: Sequence[Site],
    hours: int = 24,
    now: datetime | None = None,
) -> BackfillResult:
    """Store past nearest-station readings without raising alerts for them."""
    if not 1 <= hours <= MAX_WEATHER_HOURS:
        raise ValueError(f"hours must be between 1 and {MAX_WEATHER_HOURS}")
    start = (now or datetime.now(UTC)) - timedelta(hours=hours)
    result = BackfillResult()
    for site in sites:
        try:
            observations = await provider.fetch_history([site], start)
        except Exception as exc:  # noqa: BLE001 - one failed station must not stop the rest
            result.failed.append(f"{site.name}: {exc}")
            continue
        written = await store_observations(session, observations, evaluate_rules=False)
        result.stored += written
        result.skipped += len(observations) - written
        await session.commit()
    return result
