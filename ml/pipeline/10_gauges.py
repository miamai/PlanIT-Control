"""Row 8: nearest river gauge (within ~10 km), its NWS flood stage, and daily gauge height.

- NWS NWPS API: gauges near the site, with flood categories and the matching USGS id.
- USGS Water Data API (dataretrieval.waterdata): daily gauge height 2019-2025, falling back to
  instantaneous values reduced to a local-day max when no daily series is published.
  (The legacy NWIS services time out; waterdata is their replacement.)
- Also stores log distance to the nearest USGS stream monitoring location, used as a
  "distance to river" proxy.

The USGS API rate-limits anonymous use hard, so this is resumable (per-site JSON in
raw/gauges/) and backs off on 429s. Set API_USGS_PAT for a higher limit.

Adds gauge_lid, gauge_usgs_id, gauge_dist_km, flood_stage_ft, log_dist_stream_km to sites.parquet.
Output: data/raw/gauges/{site_id}.parquet (date, gage_height_ft)
"""

from __future__ import annotations

import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import PROCESSED, RAW, haversine_km, session  # noqa: E402

warnings.filterwarnings("ignore")
import dataretrieval.waterdata as wd  # noqa: E402

NWPS = "https://api.water.noaa.gov/nwps/v1/gauges"
MAX_GAUGE_KM = 10.0
STREAM_SEARCH_DEG = 0.35
STREAM_CAP_KM = 40.0
OUT = RAW / "gauges"


def get(s, url: str, params: dict | None = None):
    """GET with backoff: NWPS returns 429 when hit quickly, sometimes for several minutes."""
    for attempt in range(12):
        try:
            r = s.get(url, params=params, timeout=60)
        except requests.ConnectionError as e:
            print(f"    NWPS connection dropped ({e.__class__.__name__}); retrying in 30s", flush=True)
            time.sleep(30)
            continue
        if r.status_code != 429:
            r.raise_for_status()
            if not getattr(r, "from_cache", False):
                time.sleep(2.0)
            return r
        retry_after = r.headers.get("Retry-After", "")
        wait = max(float(retry_after) if retry_after.isdigit() else 0.0, 30.0 * (attempt + 1))
        print(f"    NWPS rate limit; sleeping {wait:.0f}s", flush=True)
        time.sleep(wait)
    r.raise_for_status()


def usgs(fn, **kwargs) -> pd.DataFrame:
    """Call a waterdata function, sleeping through rate-limit windows."""
    for attempt in range(12):
        try:
            df, _ = fn(**kwargs)
            time.sleep(2.0)
            return df
        except Exception as e:  # noqa: BLE001
            name = type(e).__name__
            if "RateLimited" in name or "Quota" in name or "429" in str(e):
                wait = 300
                print(f"    USGS rate limit; sleeping {wait}s", flush=True)
                time.sleep(wait)
                continue
            raise
    raise RuntimeError("USGS rate limit did not clear")


def nwps_candidates(lat: float, lon: float, s) -> list[dict]:
    r = get(s, NWPS, {"bbox.xmin": lon - 0.15, "bbox.ymin": lat - 0.12, "bbox.xmax": lon + 0.15,
                      "bbox.ymax": lat + 0.12, "srid": "EPSG_4326"})
    gauges = r.json().get("gauges", [])
    for g in gauges:
        g["dist_km"] = float(haversine_km(lat, lon, g["latitude"], g["longitude"]))
    return sorted((g for g in gauges if g["dist_km"] <= MAX_GAUGE_KM), key=lambda g: g["dist_km"])


def flood_stage(lid: str, s) -> tuple[str | None, float | None]:
    d = get(s, f"{NWPS}/{lid}").json()
    minor = (((d.get("flood") or {}).get("categories") or {}).get("minor") or {}).get("stage")
    return d.get("usgsId") or None, (float(minor) if minor is not None and minor > 0 else None)


def continuous_daily_max(usgs_id: str, tz: str) -> pd.DataFrame:
    """Many gauges publish stage only as instantaneous values; reduce them to a local-day max."""
    frames = []
    for year in range(2019, 2026):
        c = usgs(wd.get_continuous, monitoring_location_id=f"USGS-{usgs_id}", parameter_code="00065",
                 time=f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z")
        if not c.empty:
            frames.append(c[["time", "value"]])
    if not frames:
        return pd.DataFrame()
    c = pd.concat(frames)
    c["date"] = pd.to_datetime(c["time"], utc=True).dt.tz_convert(tz).dt.tz_localize(None).dt.normalize()
    c["value"] = pd.to_numeric(c["value"], errors="coerce")
    return c.groupby("date")["value"].max().rename("gage_height_ft").reset_index().dropna()


def daily_stage(usgs_id: str, tz: str) -> pd.DataFrame:
    df = usgs(wd.get_daily, monitoring_location_id=f"USGS-{usgs_id}", parameter_code="00065",
              time="2019-01-01/2025-12-31")
    if df.empty:
        return continuous_daily_max(usgs_id, tz)
    # Prefer daily max (00001), then mean (00003), then whatever single daily reading exists.
    stats = df["statistic_id"].unique().tolist()
    pick = next((s for s in ("00001", "00003") if s in stats), stats[0])
    df = df[df["statistic_id"] == pick]
    return pd.DataFrame({"date": pd.to_datetime(df["time"]).dt.tz_localize(None).dt.normalize(),
                         "gage_height_ft": pd.to_numeric(df["value"], errors="coerce")}).dropna()


def stream_distance_km(lat: float, lon: float) -> float:
    df = usgs(wd.get_monitoring_locations,
              bbox=[lon - STREAM_SEARCH_DEG, lat - STREAM_SEARCH_DEG, lon + STREAM_SEARCH_DEG, lat + STREAM_SEARCH_DEG],
              site_type_code="ST", skip_geometry=False)
    if df.empty or "geometry" not in df:
        return STREAM_CAP_KM
    # Without geopandas, geometry comes back as a plain [lon, lat] list.
    xy = [(p.x, p.y) if hasattr(p, "x") else (p["coordinates"] if isinstance(p, dict) else p)
          for p in df["geometry"].dropna()]
    if not xy:
        return STREAM_CAP_KM
    lons = np.array([float(x) for x, _ in xy])
    lats = np.array([float(y) for _, y in xy])
    return float(min(STREAM_CAP_KM, haversine_km(lat, lon, lats, lons).min()))


def process_site(site, s) -> dict:
    cache = OUT / f"{site.site_id}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    info = {"site_id": site.site_id, "gauge_lid": None, "gauge_usgs_id": None,
            "gauge_dist_km": None, "flood_stage_ft": None}
    for g in nwps_candidates(site.lat, site.lon, s):
        usgs_id, stage = flood_stage(g["lid"], s)
        if not usgs_id or stage is None:
            continue
        daily = daily_stage(usgs_id, site.timezone)
        if len(daily) < 365:
            continue
        daily.to_parquet(OUT / f"{site.site_id}.parquet", index=False)
        info.update(gauge_lid=g["lid"], gauge_usgs_id=usgs_id, gauge_dist_km=round(g["dist_km"], 2),
                    flood_stage_ft=stage, gauge_days=len(daily))
        break
    dist = stream_distance_km(site.lat, site.lon)
    info["log_dist_stream_km"] = float(np.log1p(dist))
    cache.write_text(json.dumps(info))
    return info


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = PROCESSED / "sites.parquet"
    sites = pd.read_parquet(path)
    s = session("nwps_cache")
    rows = []
    for site in sites.itertuples():
        info = process_site(site, s)
        rows.append(info)
        print(site.site_id, info["gauge_lid"], info["gauge_usgs_id"], info["flood_stage_ft"],
              f"stream {np.expm1(info['log_dist_stream_km']):.1f} km", flush=True)
    g = pd.DataFrame(rows)[["site_id", "gauge_lid", "gauge_usgs_id", "gauge_dist_km", "flood_stage_ft",
                            "log_dist_stream_km"]]
    g[["gauge_dist_km", "flood_stage_ft"]] = g[["gauge_dist_km", "flood_stage_ft"]].astype(float)

    # USGS gage height and the NWS flood stage are sometimes on different datums (e.g. St. Paul
    # reads ~90 ft against a 16 ft flood stage). A gauge "at flood" most of the time is a datum
    # mismatch: drop the flood stage there and keep only the datum-free 3-day rise.
    for i, r in g[g["flood_stage_ft"].notna()].iterrows():
        stage = pd.read_parquet(OUT / f"{r.site_id}.parquet")["gage_height_ft"]
        if (stage >= r.flood_stage_ft).mean() > 0.25:
            print(f"  {r.site_id}: stage above flood stage {100 * (stage >= r.flood_stage_ft).mean():.0f}% "
                  f"of days; datum mismatch, dropping flood stage")
            g.loc[i, "flood_stage_ft"] = np.nan
    sites = sites.drop(columns=[c for c in g.columns if c != "site_id" and c in sites]).merge(g, on="site_id")
    sites.to_parquet(path, index=False)
    print(f"{sites['gauge_lid'].notna().sum()} sites with a gauge + flood stage")


if __name__ == "__main__":
    main()
