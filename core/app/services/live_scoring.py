"""Keep each ML-covered site's Hazard Index current between evening briefings.

The narrative briefing is still written once per site and day. In between, the worker rescores
each site's operational day (today until the briefing hour, then tomorrow) with the newest
forecast, active alerts and crew reports, and updates that day's stored score in place.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.entities import CrewReport, Site
from app.services.briefing import (
    BRIEFING_LOCAL_HOUR,
    active_alert_query,
    reports_since_previous,
    store_ml_score,
)
from app.services.ml import MLClient

# Reports older than this barely move the wildlife score (3-day decay) and are not watched.
REPORT_WATCH_WINDOW = timedelta(days=7)


def operational_date(site: Site, now: datetime) -> date:
    """Today until the evening briefing hour, then tomorrow, the day that briefing covers."""
    local_now = now.astimezone(ZoneInfo(site.timezone))
    if local_now.hour >= BRIEFING_LOCAL_HOUR:
        return local_now.date() + timedelta(days=1)
    return local_now.date()


@dataclass
class ScoringPass:
    scored: int = 0
    skipped: int = 0
    failed: int = 0
    first_error: str | None = None


async def rescore_sites(
    session_factory: async_sessionmaker[AsyncSession],
    client: MLClient,
    now: datetime,
    site_ids: Collection[uuid.UUID] | None = None,
) -> ScoringPass:
    """Rescore every ML-covered site, or only `site_ids`. One site's failure never stops the pass."""
    result = ScoringPass()
    async with session_factory() as session:
        query = select(Site).where(Site.ml_site_id.is_not(None))
        if site_ids is not None:
            query = query.where(Site.id.in_(list(site_ids)))
        sites = (await session.scalars(query)).all()
    for site in sites:
        try:
            stored = await _rescore_site(session_factory, client, site, now)
        except Exception as exc:  # noqa: BLE001 - service, network or validation failure
            result.failed += 1
            result.first_error = result.first_error or f"{site.name}: {type(exc).__name__}: {exc}"
            continue
        if stored:
            result.scored += 1
        else:
            result.skipped += 1
    return result


async def _rescore_site(
    session_factory: async_sessionmaker[AsyncSession],
    client: MLClient,
    site: Site,
    now: datetime,
) -> bool:
    prediction_date = operational_date(site, now)
    async with session_factory() as session:
        alerts = list((await session.scalars(active_alert_query(site.id))).all())
        reports, _ = await reports_since_previous(session, site, prediction_date, now)
    # No transaction is held open while the ML service computes.
    ml_risk = await client.score(site, prediction_date, alerts, reports)
    async with session_factory() as session:
        # Same key the evening briefing holds while it writes this day's score.
        lock_key = site.eia_plant_id * 100000 + prediction_date.toordinal() % 100000
        if not await session.scalar(
            text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": lock_key}
        ):
            return False
        await store_ml_score(session, site, prediction_date, now, ml_risk)
        await session.commit()
    return True


class NewReportWatcher:
    """Finds sites with crew reports the worker has not seen yet.

    Reports carry the observation time, which may be in the past, so new reports are found by id
    rather than by timestamp. The first call only records what already exists.
    """

    def __init__(self) -> None:
        self._seen: set[uuid.UUID] | None = None

    async def sites_with_new_reports(self, session: AsyncSession, now: datetime) -> set[uuid.UUID]:
        rows = (
            await session.execute(
                select(CrewReport.id, CrewReport.site_id).where(
                    CrewReport.reported_at >= now - REPORT_WATCH_WINDOW
                )
            )
        ).all()
        current = {report_id: site_id for report_id, site_id in rows}
        seen, self._seen = self._seen, set(current)
        if seen is None:
            return set()
        return {site_id for report_id, site_id in current.items() if report_id not in seen}
