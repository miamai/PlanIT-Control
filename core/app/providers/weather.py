from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import httpx

from app.models.entities import HazardType, QualityStatus, Site
from app.providers.base import EnvironmentalProvider, RetryingHTTPProvider
from app.schemas.domain import NormalizedObservation
from app.services.heat import heat_index_fahrenheit


class NWSWeatherProvider(EnvironmentalProvider, RetryingHTTPProvider):
    name = "nws"

    def __init__(self, client: httpx.AsyncClient, user_agent: str) -> None:
        RetryingHTTPProvider.__init__(self, client)
        self.headers = {"User-Agent": user_agent, "Accept": "application/geo+json"}

    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]:
        observations: list[NormalizedObservation] = []
        for site in sites:
            point = await self.get_json(
                f"https://api.weather.gov/points/{site.latitude:.4f},{site.longitude:.4f}",
                headers=self.headers,
            )
            station_url_list = point["properties"].get("observationStations")
            station_list = (
                await self.get_json(station_url_list, headers=self.headers)
                if station_url_list
                else {"features": []}
            )
            station_features = station_list.get("features", [])
            if station_features:
                station_url = station_features[0]["id"]
                latest = await self.get_json(
                    f"{station_url}/observations/latest", headers=self.headers
                )
                props = latest.get("properties", {})
                observed_at = datetime.fromisoformat(props["timestamp"])
                event_id = f"{station_url}:{props['timestamp']}"
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
                            metadata={"value_kind": "observed", "station": station_url},
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
                                    "station": station_url,
                                },
                            )
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
