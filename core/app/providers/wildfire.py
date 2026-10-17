from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from app.models.entities import HazardType, QualityStatus, Site
from app.providers.base import EnvironmentalProvider, ProviderError
from app.schemas.domain import NormalizedObservation
from app.utils.geo import haversine_miles


class FIRMSProvider(EnvironmentalProvider):
    name = "nasa_firms"

    def __init__(self, client: httpx.AsyncClient, map_key: str | None) -> None:
        self.client = client
        self.map_key = map_key

    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        if not self.map_key or not sites:
            raise ProviderError("NASA FIRMS map key is not configured")
        west = min(site.longitude for site in sites) - 0.5
        east = max(site.longitude for site in sites) + 0.5
        south = min(site.latitude for site in sites) - 0.5
        north = max(site.latitude for site in sites) + 0.5
        url = (
            "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
            f"{self.map_key}/VIIRS_NOAA21_NRT/{west},{south},{east},{north}/1"
        )
        response = await self.client.get(url)
        if response.status_code == 429:
            raise ProviderError("NASA FIRMS rate limit reached")
        response.raise_for_status()
        detections = list(csv.DictReader(io.StringIO(response.text)))
        results: list[NormalizedObservation] = []
        for detection in detections:
            lat, lon = float(detection["latitude"]), float(detection["longitude"])
            acquired = datetime.strptime(
                detection["acq_date"] + detection["acq_time"].zfill(4), "%Y-%m-%d%H%M"
            ).replace(tzinfo=UTC)
            event_id = ":".join(
                [detection.get("satellite", "unknown"), str(lat), str(lon), acquired.isoformat()]
            )
            for site in sites:
                distance = haversine_miles(site.latitude, site.longitude, lat, lon)
                if distance > 100:
                    continue
                results.append(
                    NormalizedObservation(
                        site_id=site.id,
                        hazard_type=HazardType.WILDFIRE,
                        source=self.name,
                        source_event_id=event_id,
                        observed_at=acquired,
                        metric_name="satellite_active_fire_detection",
                        latitude=lat,
                        longitude=lon,
                        quality_status=QualityStatus.PROVISIONAL,
                        metadata={
                            "distance_miles": round(distance, 3),
                            "confidence": detection.get("confidence"),
                            "instrument": detection.get("instrument"),
                            "satellite_detection_not_warning": True,
                        },
                    )
                )
        return results
