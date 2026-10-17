"""Row 1: pick 50 power-plant sites from EIA-860M spread across hazard regions.

Output: data/processed/sites.parquet
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from timezonefinder import TimezoneFinder

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import BROWSER_UA, PROCESSED, RAW, haversine_km, session  # noqa: E402

EIA_PAGE = "https://www.eia.gov/electricity/data/eia860m/"
MIN_MW = 20

# Approximate Mississippi River course, north to south.
MISSISSIPPI = [
    (44.98, -93.27), (44.56, -92.53), (43.80, -91.25), (42.50, -90.66), (41.52, -90.58),
    (40.81, -91.11), (39.93, -91.41), (38.89, -90.18), (38.63, -90.19), (37.31, -89.52),
    (37.00, -89.18), (36.59, -89.53), (35.15, -90.05), (34.53, -90.59), (33.41, -91.06),
    (32.35, -90.88), (31.56, -91.40), (30.45, -91.19), (29.95, -90.07),
]

# Region -> number of sites. Order matters: a plant goes to the first region that claims it.
QUOTAS = {"gulf_fl": 14, "mississippi": 12, "west": 12, "plains": 12}


def latest_eia_file() -> Path:
    dest_dir = RAW / "eia"
    dest_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(dest_dir.glob("*_generator*.xlsx"))
    if existing:
        return existing[-1]
    html = requests.get(EIA_PAGE, headers={"User-Agent": BROWSER_UA}, timeout=60).text
    links = re.findall(r'href="([^"]*_generator\d{4}\.xlsx)"', html)
    # The page lists months newest-first but links some months that don't exist yet
    # (they return an HTML error page), so take the first one that is a real xlsx.
    for href in links:
        url = "https://www.eia.gov" + href if href.startswith("/") else href
        r = requests.get(url, headers={"User-Agent": BROWSER_UA}, timeout=300)
        if r.ok and r.content[:2] == b"PK":
            dest = dest_dir / href.rsplit("/", 1)[-1]
            dest.write_bytes(r.content)
            print(f"EIA-860M: {dest.name}")
            return dest
    raise RuntimeError("No downloadable EIA-860M xlsx found")


def load_plants(path: Path) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name="Operating", header=None, nrows=10)
    header_row = int(raw.index[raw.eq("Plant ID").any(axis=1)][0])
    df = pd.read_excel(path, sheet_name="Operating", header=header_row)
    df = df[pd.to_numeric(df["Plant ID"], errors="coerce").notna()].copy()
    df["Plant ID"] = df["Plant ID"].astype(int)
    df["mw"] = pd.to_numeric(df["Nameplate Capacity (MW)"], errors="coerce").fillna(0)
    df["Latitude"] = pd.to_numeric(df["Latitude"], errors="coerce")
    df["Longitude"] = pd.to_numeric(df["Longitude"], errors="coerce")

    # One row per plant: the file lists each generator separately.
    main_tech = (
        df.groupby(["Plant ID", "Technology"])["mw"].sum().reset_index()
        .sort_values("mw", ascending=False).drop_duplicates("Plant ID")
        .set_index("Plant ID")["Technology"]
    )
    plants = df.groupby("Plant ID").agg(
        name=("Plant Name", "first"),
        state=("Plant State", "first"),
        county=("County", "first"),
        lat=("Latitude", "first"),
        lon=("Longitude", "first"),
        capacity_mw=("mw", "sum"),
    )
    plants["technology"] = main_tech
    plants = plants.dropna(subset=["lat", "lon"]).reset_index().rename(columns={"Plant ID": "plant_id"})
    return plants


def river_distance_km(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    pts = []
    for (a_lat, a_lon), (b_lat, b_lon) in zip(MISSISSIPPI, MISSISSIPPI[1:]):
        n = max(2, int(haversine_km(a_lat, a_lon, b_lat, b_lon) / 2))
        pts += list(zip(np.linspace(a_lat, b_lat, n), np.linspace(a_lon, b_lon, n)))
    pts = np.array(pts)
    d = haversine_km(lat[:, None], lon[:, None], pts[None, :, 0], pts[None, :, 1])
    return d.min(axis=1)


def assign_region(p: pd.DataFrame) -> pd.Series:
    st, lat, lon = p["state"], p["lat"], p["lon"]
    river_km = river_distance_km(lat.to_numpy(), lon.to_numpy())
    gulf = (st == "FL") | (st.isin(["TX", "LA", "MS", "AL"]) & (lat < 30.9) & (lon > -97.8))
    miss = (river_km < 25) & st.isin(["MN", "WI", "IA", "IL", "MO", "KY", "TN", "AR", "MS", "LA"])
    west = st.isin(["CA", "AZ"])
    plains = st.isin(["OK", "KS", "NE", "SD", "ND"]) | ((st == "TX") & (lat > 32) & (lon < -97))
    region = np.select([gulf, miss, west, plains], ["gulf_fl", "mississippi", "west", "plains"], "")
    return pd.Series(region, index=p.index)


def spread_pick(cands: pd.DataFrame, k: int) -> pd.DataFrame:
    """Farthest-point sampling, seeded with the biggest plant, so sites cover the region."""
    cands = cands.sort_values("capacity_mw", ascending=False).reset_index(drop=True)
    lat, lon = cands["lat"].to_numpy(), cands["lon"].to_numpy()
    chosen = [0]
    min_d = haversine_km(lat[0], lon[0], lat, lon)
    while len(chosen) < min(k, len(cands)):
        i = int(np.argmax(min_d))
        chosen.append(i)
        min_d = np.minimum(min_d, haversine_km(lat[i], lon[i], lat, lon))
    return cands.iloc[chosen]


def county_fips(lat: float, lon: float, s) -> str | None:
    r = s.get(
        "https://geo.fcc.gov/api/census/area",
        params={"lat": lat, "lon": lon, "censusYear": 2020, "format": "json"},
        timeout=60,
    )
    r.raise_for_status()
    results = r.json().get("results") or []
    return results[0]["county_fips"] if results else None


def main() -> None:
    plants = load_plants(latest_eia_file())
    plants = plants[plants["capacity_mw"] >= MIN_MW].copy()
    plants["region"] = assign_region(plants)

    picks = [spread_pick(plants[plants["region"] == region], k).assign(region=region)
             for region, k in QUOTAS.items()]
    sites = pd.concat(picks, ignore_index=True)

    tf = TimezoneFinder()
    s = session("fcc_cache")
    sites["timezone"] = [tf.timezone_at(lat=a, lng=o) for a, o in zip(sites["lat"], sites["lon"])]
    sites["county_fips"] = [county_fips(a, o, s) for a, o in zip(sites["lat"], sites["lon"])]
    sites["site_id"] = "EIA-" + sites["plant_id"].astype(str)

    cols = ["site_id", "plant_id", "name", "state", "county", "county_fips", "lat", "lon",
            "timezone", "region", "technology", "capacity_mw"]
    sites = sites[cols]
    assert sites["county_fips"].notna().all(), sites[sites["county_fips"].isna()]
    sites.to_parquet(PROCESSED / "sites.parquet", index=False)
    print(sites.groupby("region").size().to_string())
    print(sites[["site_id", "name", "state", "region", "technology", "capacity_mw"]].to_string())


if __name__ == "__main__":
    main()
