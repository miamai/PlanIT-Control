from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import httpx

from app.models.entities import HazardType, QualityStatus, Site
from app.providers.base import EnvironmentalProvider, RetryingHTTPProvider
from app.schemas.domain import NormalizedObservation
from app.services.heat import heat_index_fahrenheit

# 500 readings a page; a week of 5-minute readings is about 2,000.
HISTORY_MAX_PAGES = 10


class NWSWeatherProvider(EnvironmentalProvider, RetryingHTTPProvider):
    name = "nws"

    def __init__(self, client: httpx.AsyncClient, user_agent: str) -> None:
        RetryingHTTPProvider.__init__(self, client)
        self.headers = {"User-Agent": user_agent, "Accept": "application/geo+json"}

    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        observations: list[NormalizedObservation] = []
        for site in sites:
            point = await self._point(site)
            station_url = await self._nearest_station(point)
            if station_url:
                latest = await self.get_json(
                    f"{station_url}/observations/latest", headers=self.headers
                )
                observations.extend(
                    self._station_observations(site, station_url, latest.get("properties", {}))
                )
            hourly_url = point["properties"]["forecastHourly"]
            forecast = await self.get_json(hourly_url, headers=self.headers)
            for period in forecast["properties"].get("periods", [])[:24]:
                observed_at = datetime.fromisoformat(period["startTime"])
                event_id = f"{site.eia_plant_id}:{period['number']}:{period['startTime']}"
                observations.append(
                    NormalizedObservation(
                        site_id=site.id,
                        hazard_type=HazardType.WEATHER,
                        source=self.name,
                        source_event_id=event_id,
                        observed_at=observed_at,
                        valid_until=datetime.fromisoformat(period["endTime"]),
                        metric_name="forecast_temperature",
                        numeric_value=float(period["temperature"]),
                        unit="degF" if period["temperatureUnit"] == "F" else "degC",
                        latitude=site.latitude,
                        longitude=site.longitude,
                        quality_status=QualityStatus.PROVISIONAL,
                        metadata={
                            "value_kind": "forecast",
                            "short_forecast": period.get("shortForecast"),
                            "wind_speed": period.get("windSpeed"),
                            "wind_direction": period.get("windDirection"),
                            "probability_of_precipitation": period.get(
                                "probabilityOfPrecipitation"
                            ),
                        },
                    )
                )
        return observations

    async def fetch_history(
        self, sites: Sequence[Site], start: datetime
    ) -> list[NormalizedObservation]:
        """Past nearest-station readings back to `start`, one per hour (NWS keeps about a week)."""
        observations: list[NormalizedObservation] = []
        for site in sites:
            station_url = await self._nearest_station(await self._point(site))
            if not station_url:
                continue
            hourly: dict[datetime, dict] = {}
            url: str | None = f"{station_url}/observations"
            params: dict | None = {"start": start.isoformat(), "limit": 500}
            for _ in range(HISTORY_MAX_PAGES):
                if not url:
                    break
                page = await self.get_json(url, headers=self.headers, params=params)
                features = page.get("features", [])
                oldest = None
                for feature in features:
                    props = feature.get("properties", {})
                    observed_at = datetime.fromisoformat(props["timestamp"])
                    oldest = observed_at if oldest is None else min(oldest, observed_at)
                    if observed_at < start:
                        continue
                    hour = observed_at.replace(minute=0, second=0, microsecond=0)
                    if hour not in hourly or _hourly_rank(props) > _hourly_rank(hourly[hour]):
                        hourly[hour] = props
                # Pages run newest to oldest; the cursor link carries on from the last one.
                url = page.get("pagination", {}).get("next") if oldest and oldest >= start else None
                params = None
            for props in hourly.values():
                observations.extend(
                    self._station_observations(site, station_url, props, backfilled=True)
                )
        return observations

    async def _point(self, site: Site) -> dict:
        return await self.get_json(
            f"https://api.weather.gov/points/{site.latitude:.4f},{site.longitude:.4f}",
            headers=self.headers,
        )

    async def _nearest_station(self, point: dict) -> str | None:
        station_url_list = point["properties"].get("observationStations")
        if not station_url_list:
            return None
        station_list = await self.get_json(station_url_list, headers=self.headers)
        station_features = station_list.get("features", [])
        return station_features[0]["id"] if station_features else None

    def _station_observations(
        self, site: Site, station_url: str, props: dict, backfilled: bool = False
    ) -> list[NormalizedObservation]:
        observations: list[NormalizedObservation] = []
        observed_at = datetime.fromisoformat(props["timestamp"])
        event_id = f"{station_url}:{props['timestamp']}"
        provenance = {"station": station_url, **({"backfilled": True} if backfilled else {})}
        metric_map = {
            "temperature": ("temperature", "degC"),
            "relativeHumidity": ("relative_humidity", "percent"),
            "windSpeed": ("wind_speed", "km_h-1"),
            "precipitationLastHour": ("precipitation_accumulation", "mm"),
        }
        values: dict[str, float] = {}
        for provider_name, (metric_name, unit) in metric_map.items():
            value = (props.get(provider_name) or {}).get("value")
            if value is None:
                continue
            values[metric_name] = float(value)
            observations.append(
                NormalizedObservation(
                    site_id=site.id,
                    hazard_type=HazardType.WEATHER,
                    source="nws_observation",
                    source_event_id=event_id,
                    observed_at=observed_at,
                    metric_name=metric_name,
                    numeric_value=float(value),
                    unit=unit,
                    latitude=site.latitude,
                    longitude=site.longitude,
                    quality_status=QualityStatus.PROVISIONAL,
                    metadata={"value_kind": "observed", **provenance},
                )
            )
        if "temperature" in values and "relative_humidity" in values:
            temperature_f = values["temperature"] * 9 / 5 + 32
            heat_index = heat_index_fahrenheit(temperature_f, values["relative_humidity"])
            if heat_index is not None:
                observations.append(
                    NormalizedObservation(
                        site_id=site.id,
                        hazard_type=HazardType.HEAT,
                        source="planit_noaa_formula",
                        source_event_id=event_id,
                        observed_at=observed_at,
                        metric_name="calculated_heat_index",
                        numeric_value=heat_index,
                        unit="degF",
                        latitude=site.latitude,
                        longitude=site.longitude,
                        quality_status=QualityStatus.PROVISIONAL,
                        metadata={
                            "value_kind": "calculated",
                            "formula": "NOAA/NWS Rothfusz regression",
                            **provenance,
                        },
                    )
                )
        return observations

    async def fetch_alerts(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        observations: list[NormalizedObservation] = []
        for site in sites:
            payload = await self.get_json(
                "https://api.weather.gov/alerts/active",
                params={"point": f"{site.latitude},{site.longitude}"},
                headers=self.headers,
            )
            for feature in payload.get("features", []):
                props = feature["properties"]
                observations.append(
                    NormalizedObservation(
                        site_id=site.id,
                        hazard_type=(
                            HazardType.FLOOD
                            if "Flood" in props.get("event", "")
                            else HazardType.WEATHER
                        ),
                        source="nws_alerts",
                        source_event_id=feature["id"],
                        observed_at=datetime.fromisoformat(props["sent"]),
                        valid_until=(
                            datetime.fromisoformat(props["expires"])
                            if props.get("expires")
                            else None
                        ),
                        metric_name="official_alert",
                        latitude=site.latitude,
                        longitude=site.longitude,
                        quality_status=QualityStatus.VERIFIED,
                        metadata={
                            "event": props.get("event"),
                            "severity": props.get("severity"),
                            "urgency": props.get("urgency"),
                            "headline": props.get("headline"),
                            "instruction": props.get("instruction"),
                        },
                    )
                )
        return observations


def _hourly_rank(props: dict) -> tuple[bool, str]:
    """Prefer the routine hourly report (the only one carrying rainfall), then the newest."""
    return ("precipitationLastHour" in props, props["timestamp"])
