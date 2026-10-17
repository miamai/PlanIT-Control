from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from app.models.entities import HazardType, QualityStatus, Site
from app.providers.base import EnvironmentalProvider, RetryingHTTPProvider
from app.schemas.domain import NormalizedObservation
from app.utils.geo import haversine_miles


class USGSWaterProvider(EnvironmentalProvider, RetryingHTTPProvider):
    """USGS modern Water Data OGC API adapter.

    The old waterservices.usgs.gov NWIS endpoint is scheduled for retirement in
    early 2027, so this adapter uses api.waterdata.usgs.gov exclusively.
    """

    name = "usgs"
    endpoint = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items"

    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        results: list[NormalizedObservation] = []
        end = datetime.now(UTC)
        start = end - timedelta(hours=6)
        for site in sites:
            delta = 0.25
            bbox = (
                f"{site.longitude - delta},{site.latitude - delta},"
                f"{site.longitude + delta},{site.latitude + delta}"
            )
            latest: dict[tuple[str, str], dict] = {}
            for code in ("00060", "00065"):
                payload = await self.get_json(
                    self.endpoint,
                    params={
                        "f": "json",
                        "bbox": bbox,
                        "parameter_code": code,
                        "datetime": f"{start.isoformat()}/{end.isoformat()}",
                        "limit": 1000,
                    },
                    headers={"Accept": "application/geo+json"},
                )
                for feature in payload.get("features", []):
                    properties = feature.get("properties", {})
                    key = (
                        properties.get("monitoring_location_id", "unknown"),
                        properties.get("parameter_code", code),
                    )
                    previous = latest.get(key)
                    if previous is None or properties.get("time", "") > previous["properties"].get(
                        "time", ""
                    ):
                        latest[key] = feature
            for (station_id, code), feature in latest.items():
                properties = feature["properties"]
                coordinates = feature.get("geometry", {}).get("coordinates", [])
                if len(coordinates) < 2 or properties.get("value") is None:
                    continue
                station_longitude, station_latitude = map(float, coordinates[:2])
                distance = haversine_miles(
                    site.latitude, site.longitude, station_latitude, station_longitude
                )
                observed_at = datetime.fromisoformat(properties["time"])
                results.append(
                    NormalizedObservation(
                        site_id=site.id,
                        hazard_type=HazardType.FLOOD,
                        source=self.name,
                        source_event_id=f"{station_id}:{code}:{observed_at.isoformat()}",
                        observed_at=observed_at,
                        metric_name="gage_height" if code == "00065" else "streamflow",
                        numeric_value=float(properties["value"]),
                        unit=properties.get("unit_of_measure"),
                        latitude=station_latitude,
                        longitude=station_longitude,
                        quality_status=(
                            QualityStatus.VERIFIED
                            if properties.get("approval_status") == "Approved"
                            else QualityStatus.PROVISIONAL
                        ),
                        metadata={
                            "station_id": station_id,
                            "station_name": station_id,
                            "station_latitude": station_latitude,
                            "station_longitude": station_longitude,
                            "distance_miles": round(distance, 3),
                            "qualifiers": [properties["qualifier"]]
                            if properties.get("qualifier")
                            else [],
                            "approval_status": properties.get("approval_status"),
                            "confirmed_flooding": False,
                            "api": "USGS Water Data OGC continuous",
                        },
                    )
                )
        return results
