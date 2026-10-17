from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from app.models.entities import HazardType, QualityStatus, Site
from app.providers.base import EnvironmentalProvider, RetryingHTTPProvider
from app.schemas.domain import NormalizedObservation
from app.utils.geo import haversine_miles


class USGSWaterProvider(EnvironmentalProvider, RetryingHTTPProvider):
    name = "usgs"

    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        results: list[NormalizedObservation] = []
        for site in sites:
            delta = 0.25
            payload = await self.get_json(
                "https://waterservices.usgs.gov/nwis/iv/",
                params={
                    "format": "json",
                    "bBox": f"{site.longitude - delta},{site.latitude - delta},{site.longitude + delta},{site.latitude + delta}",
                    "siteType": "ST",
                    "parameterCd": "00060,00065",
                    "siteStatus": "active",
                },
            )
            for series in payload.get("value", {}).get("timeSeries", []):
                source = series.get("sourceInfo", {})
                variable = series.get("variable", {})
                values = series.get("values", [{}])[0].get("value", [])
                if not values:
                    continue
                latest = values[-1]
                station_id = source.get("siteCode", [{}])[0].get("value", "unknown")
                code = variable.get("variableCode", [{}])[0].get("value", "unknown")
                location = source.get("geoLocation", {}).get("geogLocation", {})
                station_latitude = float(location.get("latitude"))
                station_longitude = float(location.get("longitude"))
                distance = haversine_miles(
                    site.latitude, site.longitude, station_latitude, station_longitude
                )
                results.append(
                    NormalizedObservation(
                        site_id=site.id,
                        hazard_type=HazardType.FLOOD,
                        source=self.name,
                        source_event_id=f"{station_id}:{code}:{latest['dateTime']}",
                        observed_at=datetime.fromisoformat(latest["dateTime"]),
                        metric_name="gage_height" if code == "00065" else "streamflow",
                        numeric_value=float(latest["value"]),
                        unit=variable.get("unit", {}).get("unitCode"),
                        quality_status=QualityStatus.PROVISIONAL,
                        metadata={
                            "station_id": station_id,
                            "station_name": source.get("siteName"),
                            "station_latitude": station_latitude,
                            "station_longitude": station_longitude,
                            "distance_miles": round(distance, 3),
                            "qualifiers": latest.get("qualifiers", []),
                            "confirmed_flooding": False,
                        },
                    )
                )
        return results
