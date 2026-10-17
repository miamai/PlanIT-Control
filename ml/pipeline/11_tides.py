"""Row 9: NOAA CO-OPS daily high water relative to MHHW for coastal sites.

A site is coastal if a CO-OPS water-level station is within 25 km.
Adds tide_station, tide_dist_km to sites.parquet.
Output: data/raw/tides/{site_id}.parquet (date, max_above_mhhw_ft)
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import PROCESSED, RAW, YEARS, haversine_km, session  # noqa: E402

STATIONS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json"
DATA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
MAX_KM = 25.0
OUT = RAW / "tides"


def stations(s) -> pd.DataFrame:
    r = s.get(STATIONS, params={"type": "waterlevels"}, timeout=60)
    r.raise_for_status()
    st = pd.DataFrame(r.json()["stations"])
    st = st[st["tidal"] & ~st["greatlakes"]]
    return st[["id", "name", "lat", "lng"]]


def high_low(station: str, year: int, s) -> pd.DataFrame:
    params = {"product": "high_low", "station": station, "begin_date": f"{year}0101",
              "end_date": f"{year}1231", "datum": "MHHW", "units": "english",
              "time_zone": "lst_ldt", "format": "json", "application": "PlanIT"}
    r = s.get(DATA, params=params, timeout=120)
    r.raise_for_status()
    rows = r.json().get("data", [])
    if not rows:
        return pd.DataFrame(columns=["date", "max_above_mhhw_ft"])
    df = pd.DataFrame(rows)
    df["v"] = pd.to_numeric(df["v"], errors="coerce")
    df["date"] = pd.to_datetime(df["t"]).dt.normalize()
    return df.groupby("date")["v"].max().rename("max_above_mhhw_ft").reset_index()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = PROCESSED / "sites.parquet"
    sites = pd.read_parquet(path)
    s = session("coops_cache")
    st = stations(s)
    rows = []
    for site in sites.itertuples():
        d = haversine_km(site.lat, site.lon, st["lat"].to_numpy(), st["lng"].to_numpy())
        order = np.argsort(d)
        info = {"site_id": site.site_id, "tide_station": None, "tide_dist_km": np.nan}
        for i in order[:3]:
            if d[i] > MAX_KM:
                break
            sid = st["id"].iloc[i]
            df = pd.concat([high_low(sid, y, s) for y in YEARS], ignore_index=True)
            if df["max_above_mhhw_ft"].notna().sum() < 365:
                continue
            df.to_parquet(OUT / f"{site.site_id}.parquet", index=False)
            info.update(tide_station=sid, tide_dist_km=round(float(d[i]), 2))
            print(site.site_id, sid, st["name"].iloc[i], f"{d[i]:.1f} km", len(df), "days")
            break
        rows.append(info)
    t = pd.DataFrame(rows)
    sites = sites.drop(columns=[c for c in t.columns if c != "site_id" and c in sites]).merge(t, on="site_id")
    sites.to_parquet(path, index=False)
    print(f"{sites['tide_station'].notna().sum()} coastal sites with tide data")


if __name__ == "__main__":
    main()
