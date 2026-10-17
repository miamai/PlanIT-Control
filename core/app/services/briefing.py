from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Alert, AlertStatus, HazardObservation, SafetyBriefing, Site


async def generate_due_briefings(
    session: AsyncSession, now: datetime | None = None, stale_minutes: int = 60
) -> int:
    now = now or datetime.now(UTC)
    sites = (await session.scalars(select(Site))).all()
    count = 0
    for site in sites:
        local_now = now.astimezone(ZoneInfo(site.timezone))
        if local_now.hour < 18:
            continue
        briefing_date = local_now.date() + timedelta(days=1)
        lock_key = site.eia_plant_id * 100000 + briefing_date.toordinal() % 100000
        acquired = await session.scalar(
            text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": lock_key}
        )
        if not acquired:
            continue
        existing = await session.scalar(
            select(SafetyBriefing).where(
                SafetyBriefing.site_id == site.id,
                SafetyBriefing.briefing_date == briefing_date,
            )
        )
        if existing:
            continue
        active_alerts = (
            await session.scalars(
                select(Alert).where(
                    Alert.site_id == site.id,
                    Alert.status.in_(
                        [
                            AlertStatus.ACTIVE,
                            AlertStatus.ACKNOWLEDGED,
                            AlertStatus.ALL_CLEAR_ELIGIBLE,
                        ]
                    ),
                )
            )
        ).all()
        observations = (
            await session.scalars(
                select(HazardObservation)
                .where(HazardObservation.site_id == site.id)
                .order_by(HazardObservation.observed_at.desc())
                .limit(100)
            )
        ).all()
        latest_by_metric: dict[str, dict] = {}
        for item in observations:
            latest_by_metric.setdefault(
                item.metric_name,
                {
                    "value": item.numeric_value,
                    "unit": item.unit,
                    "observed_at": item.observed_at.isoformat(),
                    "source": item.source,
                    "quality_status": item.quality_status.value,
                    "is_estimated": item.is_estimated,
                },
            )
        stale_metrics = [
            metric
            for metric, data in latest_by_metric.items()
            if datetime.fromisoformat(data["observed_at"]) < now - timedelta(minutes=stale_minutes)
        ]
        warnings: list[str] = []
        if not latest_by_metric:
            warnings.append("No environmental observations were available when generated.")
        if stale_metrics:
            warnings.append(f"Stale data: {', '.join(sorted(stale_metrics))}")
        briefing = SafetyBriefing(
            site_id=site.id,
            briefing_date=briefing_date,
            summary=(
                f"Next-day safety briefing for {site.name}, {site.county or 'unknown county'}, "
                f"{site.state}. Review current conditions and established site procedures before work."
            ),
            hazard_details={
                "site_timezone": site.timezone,
                "active_alerts": [
                    {
                        "type": alert.hazard_type.value,
                        "severity": alert.severity.value,
                        "title": alert.title,
                    }
                    for alert in active_alerts
                ],
                "latest_data": latest_by_metric,
                "warnings": warnings,
                "precautions": [
                    "Conduct the site-specific pre-job safety briefing.",
                    "Verify official warnings and changing field conditions before work.",
                ],
            },
        )
        session.add(briefing)
        count += 1
    return count
