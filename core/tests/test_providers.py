from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import respx

from app.providers.flood import USGSWaterProvider
from app.providers.weather import NWSWeatherProvider
from app.providers.wildfire import FIRMSProvider


@pytest.mark.asyncio
@respx.mock
async def test_nws_forecast_normalization() -> None:
    site = SimpleNamespace(id=uuid4(), eia_plant_id=1, latitude=39.0, longitude=-77.0)
    point_url = "https://api.weather.gov/points/39.0000,-77.0000"
    hourly_url = "https://api.weather.gov/gridpoints/LWX/1,2/forecast/hourly"
    respx.get(point_url).mock(
        return_value=httpx.Response(200, json={"properties": {"forecastHourly": hourly_url}})
    )
    respx.get(hourly_url).mock(
        return_value=httpx.Response(
            200,
            json={
                "properties": {
                    "periods": [
                        {
                            "number": 1,
                            "startTime": "2026-10-17T12:00:00+00:00",
                            "endTime": "2026-10-17T13:00:00+00:00",
                            "temperature": 88,
                            "temperatureUnit": "F",
                            "shortForecast": "Sunny",
                            "windSpeed": "5 mph",
                            "windDirection": "N",
                            "probabilityOfPrecipitation": {"value": 0},
                        }
                    ]
                }
            },
        )
    )
    async with httpx.AsyncClient() as client:
        rows = await NWSWeatherProvider(client, "test@example.com").fetch([site])
    assert len(rows) == 1
    assert rows[0].metric_name == "forecast_temperature"
    assert rows[0].metadata["value_kind"] == "forecast"


@pytest.mark.asyncio
@respx.mock
async def test_usgs_uses_modern_water_data_ogc_and_normalizes_latest_values() -> None:
    site = SimpleNamespace(id=uuid4(), eia_plant_id=1, latitude=29.8, longitude=-90.8, state="LA")
    route = respx.route(
        method="GET",
        host="api.waterdata.usgs.gov",
        path="/ogcapi/v1/collections/continuous/items",
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "features": [
                    {
                        "properties": {
                            "monitoring_location_id": "USGS-07381000",
                            "parameter_code": "00060",
                            "time": "2026-10-17T15:45:00+00:00",
                            "value": "265",
                            "unit_of_measure": "ft^3/s",
                            "approval_status": "Provisional",
                            "qualifier": None,
                        },
                        "geometry": {"coordinates": [-90.82, 29.79]},
                    }
                ]
            },
        )
    )
    async with httpx.AsyncClient() as client:
        rows = await USGSWaterProvider(client).fetch([site])
    assert route.call_count == 2
    assert rows[0].source == "usgs"
    assert rows[0].metric_name == "streamflow"
    assert rows[0].metadata["api"] == "USGS Water Data OGC continuous"


@pytest.mark.asyncio
@respx.mock
async def test_firms_bounds_requests_by_state_group() -> None:
    sites = [
        SimpleNamespace(id=uuid4(), latitude=30.0, longitude=-90.0, state="LA"),
        SimpleNamespace(id=uuid4(), latitude=31.0, longitude=-99.0, state="TX"),
    ]
    route = respx.route(method="GET", host="firms.modaps.eosdis.nasa.gov").mock(
        return_value=httpx.Response(200, text="latitude,longitude,acq_date,acq_time\n")
    )
    async with httpx.AsyncClient() as client:
        rows = await FIRMSProvider(client, "test-key").fetch(sites)
    assert rows == []
    assert route.call_count == 2
