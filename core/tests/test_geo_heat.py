from app.services.heat import heat_index_fahrenheit
from app.utils.geo import haversine_miles


def test_haversine_known_distance() -> None:
    distance = haversine_miles(40.7128, -74.0060, 34.0522, -118.2437)
    assert 2440 < distance < 2460


def test_haversine_is_symmetric() -> None:
    forward = haversine_miles(30, -90, 31, -91)
    reverse = haversine_miles(31, -91, 30, -90)
    assert forward == reverse


def test_heat_index_only_when_applicable() -> None:
    assert heat_index_fahrenheit(75, 80) is None
    assert heat_index_fahrenheit(90, 70) == 105.9
