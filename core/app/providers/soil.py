from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import HazardObservation, HazardType, QualityStatus, Site
from app.providers.base import SoilProvider
from app.schemas.domain import NormalizedObservation


class AntecedentRainfallSoilProvider(SoilProvider):
    name = "antecedent_rainfall_proxy"

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        now = datetime.now(UTC)
        start = now - timedelta(hours=72)
        results: list[NormalizedObservation] = []
        for site in sites:
            rows = (
                await self.session.scalars(
                    select(HazardObservation).where(
                        HazardObservation.site_id == site.id,
                        HazardObservation.metric_name == "precipitation_accumulation",
                        HazardObservation.observed_at >= start,
                    )
                )
            ).all()
            total_mm = sum(row.numeric_value or 0 for row in rows if row.unit == "mm")
            results.append(
                NormalizedObservation(
                    site_id=site.id,
                    hazard_type=HazardType.SOIL,
                    source=self.name,
                    source_event_id=f"{site.id}:{now:%Y%m%d%H}",
                    observed_at=now,
                    metric_name="soil_saturation_risk_proxy",
                    numeric_value=total_mm,
                    unit="mm_72h_rainfall",
                    latitude=site.latitude,
                    longitude=site.longitude,
                    quality_status=QualityStatus.ESTIMATED,
                    is_estimated=True,
                    metadata={
                        "window_hours": 72,
                        "uncertainty": "Does not measure soil moisture; drainage and soil type unavailable",
                    },
                )
            )
        return results
