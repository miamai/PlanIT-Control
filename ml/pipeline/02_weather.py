"""Row 2: hourly Open-Meteo archive weather, one request per site per year.

Resumable: finished site-years are skipped. Throttled to stay under the free tier's
5k weighted calls/hour (a one-year, 10-variable request counts as ~26 calls).

Output: data/raw/weather/{site_id}_{year}.parquet (UTC hourly)
Usage:  uv run python pipeline/02_weather.py [--limit N]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import PROCESSED, RAW, UA, YEARS  # noqa: E402
from features import HOURLY_VARS, OPEN_METEO_UNITS  # noqa: E402

URL = "https://archive-api.open-meteo.com/v1/archive"
OUT = RAW / "weather"
SECONDS_BETWEEN_CALLS = 20


def fetch(lat: float, lon: float, year: int) -> pd.DataFrame:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": f"{year}-01-01",
        "end_date": f"{year}-12-31",
        "hourly": ",".join(HOURLY_VARS),
        "timezone": "GMT",
        **OPEN_METEO_UNITS,
    }
    while True:
        r = requests.get(URL, params=params, timeout=120, headers={"User-Agent": UA})
        if r.status_code == 429 or (r.status_code == 400 and "limit" in r.text.lower()):
            reason = r.json().get("reason", r.text) if r.headers.get("content-type", "").startswith("application/json") else r.text
            wait = 3600 if "daily" in reason.lower() else 600
            print(f"  rate limited ({reason!r}); sleeping {wait}s", flush=True)
            time.sleep(wait)
            continue
        if r.status_code >= 500:
            print(f"  server error {r.status_code}; retrying in 60s", flush=True)
            time.sleep(60)
            continue
        r.raise_for_status()
        break
    hourly = r.json()["hourly"]
    df = pd.DataFrame(hourly)
    df["time"] = pd.to_datetime(df.pop("time"), utc=True)
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="stop after N new requests")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    sites = pd.read_parquet(PROCESSED / "sites.parquet")
    todo = [(s, y) for s in sites.itertuples() for y in YEARS
            if not (OUT / f"{s.site_id}_{y}.parquet").exists()]
    print(f"{len(todo)} site-years to fetch (~{len(todo) * SECONDS_BETWEEN_CALLS / 3600:.1f} h)", flush=True)

    done = 0
    for site, year in todo:
        if args.limit is not None and done >= args.limit:
            break
        t0 = time.time()
        df = fetch(site.lat, site.lon, year)
        df.to_parquet(OUT / f"{site.site_id}_{year}.parquet", index=False)
        done += 1
        empty = [c for c in HOURLY_VARS if df[c].isna().all()]
        print(f"[{done}/{len(todo)}] {site.site_id} {year}: {len(df)} rows"
              + (f" EMPTY: {empty}" if empty else ""), flush=True)
        time.sleep(max(0.0, SECONDS_BETWEEN_CALLS - (time.time() - t0)))
    print("weather done", flush=True)


if __name__ == "__main__":
    main()
