from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.entities import (
    CrewReport,
    HazardObservation,
    HazardType,
    QualityStatus,
    Site,
)
from app.services.events import publish_event
from app.services.rules import evaluate_observation
from app.utils.geo import haversine_miles

MAX_REPORTS_PER_MINUTE = 30
MAX_SITE_DISTANCE_MILES = 100


class ReportRejected(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def store_crew_report(
    session: AsyncSession,
    settings: Settings,
    site: Site,
    *,
    reporter_subject: str,
    hazard_type: HazardType,
    description: str,
    latitude: float,
    longitude: float,
    reported_at: datetime | None = None,
    image_reference: str | None = None,
    image_metadata: dict[str, Any] | None = None,
) -> CrewReport:
    """Add a crew report (not yet committed), sharing wildlife sightings with nearby sites."""
    now = datetime.now(UTC)
    recent_count = await session.scalar(
        select(func.count())
        .select_from(CrewReport)
        .where(
            CrewReport.reporter_subject == reporter_subject,
            CrewReport.reported_at >= now - timedelta(minutes=1),
        )
    )
    if (recent_count or 0) >= MAX_REPORTS_PER_MINUTE:
        raise ReportRejected(429, "Report submission rate limit exceeded")
    if (
        haversine_miles(site.latitude, site.longitude, latitude, longitude)
        > MAX_SITE_DISTANCE_MILES
    ):
        raise ReportRejected(422, "Report coordinates are implausibly far from the selected site")
    report = CrewReport(
        site_id=site.id,
        hazard_type=hazard_type,
        description=description,
        latitude=latitude,
        longitude=longitude,
        image_reference=image_reference,
        image_metadata=image_metadata or {},
        reported_at=reported_at or now,
        reporter_subject=reporter_subject,
        verification_status="unverified",
    )
    session.add(report)
    await session.flush()
    if hazard_type == HazardType.WILDLIFE:
        sites = (await session.scalars(select(Site))).all()
        for nearby in sites:
            distance = haversine_miles(nearby.latitude, nearby.longitude, latitude, longitude)
            if distance <= settings.wildlife_share_radius_miles:
                observation = HazardObservation(
                    site_id=nearby.id,
                    hazard_type=HazardType.WILDLIFE,
                    source="crew_report",
                    source_event_id=str(report.id),
                    observed_at=report.reported_at,
                    metric_name="crew_wildlife_sighting",
                    latitude=latitude,
                    longitude=longitude,
                    metadata_={
                        "description": description,
                        "distance_miles": round(distance, 3),
                        "verification_status": "unverified",
                    },
                    quality_status=QualityStatus.PROVISIONAL,
                    is_estimated=False,
                )
                session.add(observation)
                await session.flush()
                await evaluate_observation(session, observation)
    publish_event(session, "report.created", {"report_id": str(report.id)}, report.site_id)
    return report
