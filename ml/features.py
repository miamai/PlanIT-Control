"""Daily features, shared by training (07_build_table.py) and live scoring (score.py).

Everything here takes hourly Open-Meteo data in UTC and returns one row per local day.
Keep it free of training-only logic so the live endpoint computes exactly the same thing.
"""

from __future__ import annotations

from typing import Mapping

import numpy as np
import pandas as pd

HOURLY_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "soil_moisture_0_to_7cm",
    "soil_moisture_7_to_28cm",
    "vapour_pressure_deficit",
    "shortwave_radiation",
]

# The forecast API (best_match) has no 0-7 / 7-28 cm soil layers, only the GFS layers below.
# harmonize_forecast() maps them onto the archive's ERA5 layers so live features line up.
FORECAST_SOIL_VARS = [
    "soil_moisture_0_to_1cm",
    "soil_moisture_1_to_3cm",
    "soil_moisture_3_to_9cm",
    "soil_moisture_9_to_27cm",
]

OPEN_METEO_UNITS = {
    "temperature_unit": "fahrenheit",
    "wind_speed_unit": "mph",
    "precipitation_unit": "inch",
}

REGIONS = {"gulf_fl": 0, "mississippi": 1, "west": 2, "plains": 3}

HOT_DAY_HI_F = 95.0      # heat index that counts toward a hot-day streak
RAIN_DAY_IN = 0.1        # "days since rain" threshold
API_DECAY = 0.9          # antecedent precipitation index daily decay
WORK_HOURS = range(6, 18)        # 6a-6p local
AFTERNOON_HOURS = range(12, 19)  # noon-6p local

FEATURES: dict[str, list[str]] = {
    # {hazard}_climo: how often this hazard was logged at this site in this month, 2019-2023 (the
    # baseline). The model learns what today's weather adds on top of it. Heat leaves out `region`,
    # which otherwise stood in for regional differences in NWS heat reporting.
    "heat": [
        "hi_max", "hi_hours_103_work", "t_min", "t_max", "hot_streak", "hi_max_anom", "t_max_anom",
        "rh_mean", "heat_climo",
    ],
    # The archive never reports thunderstorm weather codes (95-99), so ts_hours is always 0 in
    # training. These proxies come from the same hourly variables instead.
    "convective": [
        "precip_max_hr", "heavy_rain_hours", "precip_afternoon", "precip_day", "gust_max",
        "gust_factor_max", "temp_drop_1h_max", "td_max", "hi_max", "t_max", "doy_sin", "doy_cos", "region",
        "convective_climo",
    ],
    "flood": [
        "precip_day", "rain_72h", "rain_7d", "rain_14d", "api", "precip_max_hr", "precip_day_lag1",
        "precip_day_lag2", "sm0_mean", "sm28_mean", "sm0_change_7d", "gauge_pct_flood", "gauge_rise_3d",
        "has_gauge", "tide_max_above_mhhw", "has_tide", "fema_sfha", "fema_coastal", "log_dist_stream_km",
        "region", "flood_climo",
    ],
    "wildfire": [
        "rh_min_afternoon", "vpd_max", "wind_max", "gust_max", "days_since_rain", "rain_30d_deficit",
        "ffwi_max", "t_max", "doy_sin", "doy_cos", "region", "wildfire_climo",
    ],
}
CATEGORICAL = ["region"]

# Plain-language templates for SHAP reasons in the risk JSON.
REASON_TEXT = {
    "hi_max": "Heat index peaks at {v:.0f}°F",
    "hi_hours_103_work": "{v:.0f} work hours with heat index at or above 103°F",
    "t_min": "Overnight low only falls to {v:.0f}°F",
    "t_max": "High of {v:.0f}°F",
    "hot_streak": "Day {v:.0f} of a hot streak",
    "hi_max_anom": "Heat index {v:+.0f}°F versus normal for this time of year",
    "t_max_anom": "High is {v:+.0f}°F versus normal",
    "rh_mean": "Average humidity {v:.0f}%",
    "ts_hours": "{v:.0f} hours with thunderstorms in the forecast",
    "heavy_rain_hours": "{v:.0f} hours of heavy rain (0.1+ in/hr)",
    "precip_afternoon": "{v:.2f} in of afternoon and evening rain",
    "gust_factor_max": "Gusts up to {v:.0f} mph above the sustained wind",
    "temp_drop_1h_max": "Temperature drops {v:.0f}°F in an hour (storm outflow)",
    "td_max": "Dew point up to {v:.0f}°F",
    "precip_max_hr": "Rain rates up to {v:.2f} in/hr",
    "gust_max": "Wind gusts up to {v:.0f} mph",
    "precip_day": "{v:.2f} in of rain expected",
    "rain_72h": "{v:.2f} in of rain over 3 days",
    "rain_7d": "{v:.2f} in of rain over the past week",
    "rain_14d": "{v:.2f} in of rain over two weeks",
    "api": "Ground still wet from recent rain (index {v:.2f})",
    "precip_day_lag1": "{v:.2f} in of rain the day before",
    "precip_day_lag2": "{v:.2f} in of rain two days before",
    "sm0_mean": "Topsoil moisture {v:.2f} m³/m³",
    "sm28_mean": "Subsoil moisture {v:.2f} m³/m³",
    "sm0_change_7d": "Soil moisture changed {v:+.2f} over 7 days",
    "gauge_pct_flood": "River at {v:.0f}% of flood stage",
    "gauge_rise_3d": "River rose {v:+.1f} ft in 3 days",
    "tide_max_above_mhhw": "High water {v:+.1f} ft relative to normal high tide",
    "fema_sfha": "Site is in a FEMA flood hazard area",
    "fema_coastal": "Site is in a FEMA coastal high-hazard zone",
    "log_dist_stream_km": "Close to a river or stream",
    "rh_min_afternoon": "Afternoon humidity drops to {v:.0f}%",
    "vpd_max": "Air dryness (VPD) reaches {v:.1f} kPa",
    "wind_max": "Sustained winds up to {v:.0f} mph",
    "days_since_rain": "{v:.0f} days since meaningful rain",
    "rain_30d_deficit": "{v:+.2f} in of rain versus normal over 30 days",
    "ffwi_max": "Fire weather index {v:.0f}",
    "doy_sin": "Time of year",
    "doy_cos": "Time of year",
    "region": "Regional climate",
    "has_gauge": "River gauge nearby",
    "heat_climo": "Heat events are logged near this site on {v:.0%} of days this month (2019-2023)",
    "convective_climo": "Severe storms are logged near this site on {v:.0%} of days this month (2019-2023)",
    "flood_climo": "Flooding is logged near this site on {v:.0%} of days this month (2019-2023)",
    "wildfire_climo": "Fires are detected near this site on {v:.0%} of days this month (2019-2023)",
    "has_tide": "Tidal site",
}


# ---------------------------------------------------------------------------
# Physical formulas
# ---------------------------------------------------------------------------

def heat_index_f(t: np.ndarray, rh: np.ndarray) -> np.ndarray:
    """NWS heat index (Rothfusz regression with the NWS adjustments), °F."""
    t = np.asarray(t, dtype=float)
    rh = np.asarray(rh, dtype=float)
    simple = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + rh * 0.094)
    full = (
        -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh
        - 0.00683783 * t**2 - 0.05481717 * rh**2 + 0.00122874 * t**2 * rh
        + 0.00085282 * t * rh**2 - 0.00000199 * t**2 * rh**2
    )
    with np.errstate(invalid="ignore"):
        dry = (rh < 13) & (t >= 80) & (t <= 112)
        full = np.where(dry, full - ((13 - rh) / 4) * np.sqrt(np.clip(17 - np.abs(t - 95), 0, None) / 17), full)
        humid = (rh > 85) & (t >= 80) & (t <= 87)
        full = np.where(humid, full + ((rh - 85) / 10) * ((87 - t) / 5), full)
    return np.where((simple + t) / 2 >= 80, full, simple)


def dewpoint_f(t: np.ndarray, rh: np.ndarray) -> np.ndarray:
    """Dew point °F (Magnus formula) from temperature °F and RH %."""
    tc = (np.asarray(t, dtype=float) - 32) * 5 / 9
    with np.errstate(divide="ignore", invalid="ignore"):
        g = np.log(np.clip(np.asarray(rh, dtype=float), 1, 100) / 100) + 17.625 * tc / (243.04 + tc)
        td = 243.04 * g / (17.625 - g)
    return td * 9 / 5 + 32


def fosberg_ffwi(t: np.ndarray, rh: np.ndarray, wind_mph: np.ndarray) -> np.ndarray:
    """Fosberg Fire Weather Index (0-100) from temperature °F, RH %, wind mph."""
    t, h, u = (np.asarray(x, dtype=float) for x in (t, rh, wind_mph))
    emc = np.where(
        h < 10, 0.03229 + 0.281073 * h - 0.000578 * h * t,
        np.where(h < 50, 2.22749 + 0.160107 * h - 0.01478 * t,
                 21.0606 + 0.005565 * h**2 - 0.00035 * h * t - 0.483199 * h),
    )
    m = emc / 30.0
    eta = 1 - 2 * m + 1.5 * m**2 - 0.5 * m**3
    return np.clip(eta * np.sqrt(1 + u**2) / 0.3002, 0, 100)


# ---------------------------------------------------------------------------
# Hourly -> daily
# ---------------------------------------------------------------------------

def harmonize_forecast(hourly: pd.DataFrame) -> pd.DataFrame:
    """Map forecast-API soil layers onto the archive's 0-7 cm and 7-28 cm layers."""
    h = hourly.copy()
    if h.get("soil_moisture_0_to_7cm") is None or h["soil_moisture_0_to_7cm"].isna().all():
        h["soil_moisture_0_to_7cm"] = (
            1 * h["soil_moisture_0_to_1cm"] + 2 * h["soil_moisture_1_to_3cm"] + 4 * h["soil_moisture_3_to_9cm"]
        ) / 7
    if h.get("soil_moisture_7_to_28cm") is None or h["soil_moisture_7_to_28cm"].isna().all():
        h["soil_moisture_7_to_28cm"] = h["soil_moisture_9_to_27cm"]
    return h


def daily_from_hourly(hourly: pd.DataFrame, tz: str) -> pd.DataFrame:
    """Aggregate UTC hourly rows into local-day rows. Index: local date (Timestamp, naive)."""
    h = hourly.sort_values("time").reset_index(drop=True)
    t = pd.to_datetime(h["time"], utc=True).dt.tz_convert(tz)
    h["date"] = t.dt.tz_localize(None).dt.normalize()
    h["hour"] = t.dt.hour
    h["hi"] = heat_index_f(h["temperature_2m"], h["relative_humidity_2m"])
    h["ffwi"] = fosberg_ffwi(h["temperature_2m"], h["relative_humidity_2m"], h["wind_speed_10m"])
    h["is_ts"] = h["weather_code"].between(95, 99).astype(float)
    h["td"] = dewpoint_f(h["temperature_2m"], h["relative_humidity_2m"])
    h["gust_factor"] = h["wind_gusts_10m"] - h["wind_speed_10m"]
    h["temp_drop_1h"] = -h["temperature_2m"].diff()
    h["heavy_rain"] = (h["precipitation"] >= 0.1).astype(float)
    h["precip_pm"] = h["precipitation"].where(h["hour"].between(12, 21), 0.0)
    work = h["hour"].isin(WORK_HOURS)
    afternoon = h["hour"].isin(AFTERNOON_HOURS)
    h["hi_103_work"] = ((h["hi"] >= 103) & work).astype(float)
    h["rh_afternoon"] = h["relative_humidity_2m"].where(afternoon)

    g = h.groupby("date")
    d = pd.DataFrame({
        "n_hours": g.size(),
        "hi_max": g["hi"].max(),
        "hi_hours_103_work": g["hi_103_work"].sum(),
        "t_max": g["temperature_2m"].max(),
        "t_min": g["temperature_2m"].min(),
        "rh_mean": g["relative_humidity_2m"].mean(),
        "rh_min_afternoon": g["rh_afternoon"].min(),
        "ts_hours": g["is_ts"].sum(),
        "heavy_rain_hours": g["heavy_rain"].sum(),
        "precip_afternoon": g["precip_pm"].sum(),
        "gust_factor_max": g["gust_factor"].max(),
        "temp_drop_1h_max": g["temp_drop_1h"].max(),
        "td_max": g["td"].max(),
        "precip_day": g["precipitation"].sum(min_count=1),
        "precip_max_hr": g["precipitation"].max(),
        "wind_max": g["wind_speed_10m"].max(),
        "gust_max": g["wind_gusts_10m"].max(),
        "sm0_mean": g["soil_moisture_0_to_7cm"].mean(),
        "sm28_mean": g["soil_moisture_7_to_28cm"].mean(),
        "vpd_max": g["vapour_pressure_deficit"].max(),
        "srad_sum": g["shortwave_radiation"].sum(),
        "ffwi_max": g["ffwi"].max(),
    })
    # Drop partial days at the edges of a UTC download (fewer than 20 local hours).
    d = d[d["n_hours"] >= 20].drop(columns="n_hours")
    d.index.name = "date"
    return d


def _streak(flag: pd.Series) -> pd.Series:
    """Length of the current run of True values, 0 where False."""
    f = flag.fillna(False).astype(bool)
    groups = (~f).cumsum()
    return f.groupby(groups).cumsum().astype(float)


def add_history_features(d: pd.DataFrame) -> pd.DataFrame:
    """Rolling and lagged features. Needs a contiguous daily index (gaps become NaN)."""
    d = d.asfreq("D")
    p = d["precip_day"]
    d["rain_72h"] = p.rolling(3, min_periods=3).sum()
    d["rain_7d"] = p.rolling(7, min_periods=7).sum()
    d["rain_14d"] = p.rolling(14, min_periods=14).sum()
    d["rain_30d"] = p.rolling(30, min_periods=30).sum()
    d["precip_day_lag1"] = p.shift(1)
    d["precip_day_lag2"] = p.shift(2)

    api = np.full(len(p), np.nan)
    acc = 0.0
    for i, v in enumerate(p.to_numpy()):
        acc = API_DECAY * acc + (0.0 if np.isnan(v) else v)
        api[i] = acc
    d["api"] = api
    d.loc[d.index[:14], "api"] = np.nan  # not spun up yet

    d["sm0_change_7d"] = d["sm0_mean"] - d["sm0_mean"].shift(7)
    d["hot_streak"] = _streak(d["hi_max"] >= HOT_DAY_HI_F)

    rained = (p >= RAIN_DAY_IN).to_numpy()
    since = np.full(len(p), np.nan)
    last = None
    for i, r in enumerate(rained):
        if r:
            last = i
        if last is not None:
            since[i] = min(i - last, 90)
    d["days_since_rain"] = since

    doy = d.index.dayofyear.to_numpy()
    d["doy"] = doy
    d["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    d["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    return d


# ---------------------------------------------------------------------------
# "Normal for this site" baselines (fit on training years only)
# ---------------------------------------------------------------------------

BASELINE_VARS = ["hi_max", "t_max", "rain_30d"]


def compute_baselines(daily: pd.DataFrame, window: int = 31) -> pd.DataFrame:
    """Per-site day-of-year normals, smoothed with a circular rolling mean.

    `daily` has columns site_id, doy and BASELINE_VARS (training years only).
    Returns site_id, doy (1..366), {var}_normal.
    """
    out = []
    for site_id, g in daily.groupby("site_id"):
        clim = g.groupby("doy")[BASELINE_VARS].mean().reindex(range(1, 367)).interpolate(limit_direction="both")
        half = window // 2
        padded = pd.concat([clim.iloc[-half:], clim, clim.iloc[:half]])
        smooth = padded.rolling(window, center=True, min_periods=1).mean().iloc[half:-half]
        smooth.index = range(1, 367)
        smooth.columns = [f"{c}_normal" for c in smooth.columns]
        out.append(smooth.rename_axis("doy").reset_index().assign(site_id=site_id))
    return pd.concat(out, ignore_index=True)


def add_baseline_features(d: pd.DataFrame, site_baselines: pd.DataFrame) -> pd.DataFrame:
    b = site_baselines.set_index("doy")
    doy = d.index.dayofyear
    d["hi_max_anom"] = d["hi_max"].to_numpy() - b.loc[doy, "hi_max_normal"].to_numpy()
    d["t_max_anom"] = d["t_max"].to_numpy() - b.loc[doy, "t_max_normal"].to_numpy()
    d["rain_30d_deficit"] = d["rain_30d"].to_numpy() - b.loc[doy, "rain_30d_normal"].to_numpy()
    return d


# ---------------------------------------------------------------------------
# Site-level and enrichment features
# ---------------------------------------------------------------------------

def _get(site: Mapping, key: str, default=np.nan):
    v = site.get(key, default) if hasattr(site, "get") else getattr(site, key, default)
    return default if v is None or (isinstance(v, float) and np.isnan(v)) else v


def add_site_features(d: pd.DataFrame, site: Mapping) -> pd.DataFrame:
    d["region"] = REGIONS.get(_get(site, "region", ""), -1)
    d["fema_sfha"] = float(_get(site, "fema_sfha", np.nan))
    d["fema_coastal"] = float(_get(site, "fema_coastal", np.nan))
    d["log_dist_stream_km"] = float(_get(site, "log_dist_stream_km", np.nan))
    return d


def add_gauge_features(d: pd.DataFrame, gauge: pd.DataFrame | None, flood_stage_ft: float | None) -> pd.DataFrame:
    """gauge: daily DataFrame indexed by local date with column `gage_height_ft`."""
    d["has_gauge"] = 0.0
    d["gauge_pct_flood"] = np.nan
    d["gauge_rise_3d"] = np.nan
    if gauge is None or gauge.empty:
        return d
    gh = gauge["gage_height_ft"].reindex(d.index)
    d["has_gauge"] = 1.0
    if flood_stage_ft and flood_stage_ft > 0:
        d["gauge_pct_flood"] = 100 * gh / flood_stage_ft
    d["gauge_rise_3d"] = gh - gh.shift(3)
    return d


def add_tide_features(d: pd.DataFrame, tide: pd.DataFrame | None) -> pd.DataFrame:
    """tide: daily DataFrame indexed by local date with column `max_above_mhhw_ft`."""
    d["has_tide"] = 0.0
    d["tide_max_above_mhhw"] = np.nan
    if tide is None or tide.empty:
        return d
    d["has_tide"] = 1.0
    d["tide_max_above_mhhw"] = tide["max_above_mhhw_ft"].reindex(d.index)
    return d


CLIMO_SHRINK = 30  # pseudo-days pulling sparse site-months toward the overall rate


def climatology_rates(df: pd.DataFrame, label: str) -> pd.DataFrame:
    """Site x month positive rate with shrinkage. df: site_id, date, label (rows to learn from)."""
    overall = df[label].mean()
    g = df.assign(month=df["date"].dt.month).groupby(["site_id", "month"])[label].agg(["sum", "count"])
    return ((g["sum"] + CLIMO_SHRINK * overall) / (g["count"] + CLIMO_SHRINK)).rename(f"{label}_climo").to_frame()


def add_climatology_features(d: pd.DataFrame, site_climo: pd.DataFrame) -> pd.DataFrame:
    """site_climo: one site's rows of models/climatology.parquet (month, {hazard}_climo...)."""
    c = site_climo.set_index("month")
    for col in [x for x in c.columns if x.endswith("_climo")]:
        d[col] = c[col].reindex(d.index.month).to_numpy()
    return d


def build_features(
    hourly: pd.DataFrame,
    site: Mapping,
    site_baselines: pd.DataFrame,
    gauge: pd.DataFrame | None = None,
    tide: pd.DataFrame | None = None,
    site_climo: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Full feature pipeline for one site. Returns one row per local date."""
    d = daily_from_hourly(hourly, _get(site, "timezone"))
    d = add_history_features(d)
    d = add_baseline_features(d, site_baselines)
    if site_climo is not None:
        d = add_climatology_features(d, site_climo)
    d = add_site_features(d, site)
    d = add_gauge_features(d, gauge, _get(site, "flood_stage_ft", None))
    d = add_tide_features(d, tide)
    return d


def all_feature_names() -> list[str]:
    seen: list[str] = []
    for cols in FEATURES.values():
        seen += [c for c in cols if c not in seen]
    return seen
