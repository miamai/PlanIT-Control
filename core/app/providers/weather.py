from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from datetime import datetime

import httpx

from app.models.entities import HazardType, QualityStatus, Site
from app.providers.base import EnvironmentalProvider, ProviderError, RetryingHTTPProvider
from app.schemas.domain import NormalizedObservation
from app.services.heat import heat_index_fahrenheit


class NWSWeatherProvider(EnvironmentalProvider, RetryingHTTPProvider):
    name = "nws"

    def __init__(self, client: httpx.AsyncClient, user_agent: str) -> None:
        RetryingHTTPProvider.__init__(self, client)
        self.headers = {"User-Agent": user_agent, "Accept": "application/geo+json"}
        # Sites and stations left out of the last fetch, with why.
        self.skipped: list[str] = []

    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        return await self._each_site(sites, self._site_weather)

    async def fetch_alerts(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        return await self._each_site(sites, self._site_alerts)

    async def _each_site(
        self,
        sites: Sequence[Site],
        fetch_site: Callable[[Site], Awaitable[list[NormalizedObservation]]],
    ) -> list[NormalizedObservation]:
        """Fetch site by site; one failing site is skipped instead of failing every site."""
        self.skipped = []
        observations: list[NormalizedObservation] = []
        failed = 0
        for site in sites:
            try:
                observations.extend(await fetch_site(site))
            except Exception as exc:  # noqa: BLE001 - noted in `skipped`, the rest still run
                failed += 1
                self.skipped.append(f"{site.name}: {_first_line(exc)}")
        if sites and failed == len(sites):
            raise ProviderError(f"Every site failed; first: {self.skipped[0]}")
        return observations

    async def _site_weather(self, site: Site) -> list[NormalizedObservation]:
        observations: list[NormalizedObservation] = []
        point = await self._point(site)
        station_url = await self._nearest_station(point)
        if station_url:
            try:
                latest = await self.get_json(
                    f"{station_url}/observations/latest", headers=self.headers
                )
            except httpx.HTTPStatusError as exc:
                # A station without a recent report answers 404; the forecast is still worth it.
                self.skipped.append(
                    f"{site.name}: no latest reading from {station_url} "
                    f"({exc.response.status_code})"
                )
            else:
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
                        "probability_of_precipitation": period.get("probabilityOfPrecipitation"),
                    },
                )
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

    def _station_observations(self, site: Site, station_url: str, props: dict) -> list[NormalizedObservation]:
        observations: list[NormalizedObservation] = []
        observed_at = datetime.fromisoformat(props["timestamp"])
        event_id = f"{station_url}:{props['timestamp']}"
        provenance = {"station": station_url}
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

    async def _site_alerts(self, site: Site) -> list[NormalizedObservation]:
        observations: list[NormalizedObservation] = []
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
                        datetime.fromisoformat(props["expires"]) if props.get("expires") else None
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


def _first_line(exc: Exception) -> str:
    return (str(exc).splitlines() or [type(exc).__name__])[0][:200]
