from __future__ import annotations


def heat_index_fahrenheit(temperature_f: float, relative_humidity: float) -> float | None:
    """NOAA/NWS Rothfusz regression with standard low/high humidity adjustments."""
    if temperature_f < 80 or relative_humidity < 40:
        return None
    t, rh = temperature_f, relative_humidity
    value = (
        -42.379
        + 2.04901523 * t
        + 10.14333127 * rh
        - 0.22475541 * t * rh
        - 0.00683783 * t * t
        - 0.05481717 * rh * rh
        + 0.00122874 * t * t * rh
        + 0.00085282 * t * rh * rh
        - 0.00000199 * t * t * rh * rh
    )
    if rh < 13 and 80 <= t <= 112:
        value -= ((13 - rh) / 4) * ((17 - abs(t - 95)) / 17) ** 0.5
    elif rh > 85 and 80 <= t <= 87:
        value += ((rh - 85) / 10) * ((87 - t) / 5)
    return round(value, 1)
