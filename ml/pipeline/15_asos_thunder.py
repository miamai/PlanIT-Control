"""Thunder observed at the nearest ASOS station (within 40 km), 2019-2025, via the Iowa Environmental Mesonet.

ASOS present-weather codes report TS when thunder is heard or lightning is detected nearby
(VCTS = in the vicinity). That is the lightning record Storm Events lacks (it only logs damaging
strikes) and the archive weather codes lack (no 95-99). Full ASOS stations are preferred. Many AWOS
stations have no lightning sensor, so a quiet AWOS doesn't mean no thunder: one is used only when no
ASOS is in range and its own record shows thunder on at least AWOS_MIN_TS_DAYS days.

Adds asos_station, asos_dist_km to sites.parquet.
Output: data/raw/asos/{station}.csv (hourly wxcodes, UTC)
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import PROCESSED, RAW, haversine_km, session  # noqa: E402

STATES = ("AL AZ AR CA CO CT DE FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY "
          "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split()
NETWORK = "https://mesonet.agron.iastate.edu/geojson/network/{state}_ASOS.geojson"
DATA = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
MAX_KM = 40.0  # same scale as the 25-mile Storm Events radius
AWOS_MIN_TS_DAYS = 20
OUT = RAW / "asos"


def stations(s) -> pd.DataFrame:
    rows = []
    for st in STATES:
        r = s.get(NETWORK.format(state=st), timeout=60)
        r.raise_for_status()
        for f in r.json()["features"]:
            p = f["properties"]
            lon, lat = f["geometry"]["coordinates"]
            rows.append({"id": p["sid"], "name": p.get("sname"), "lat": lat, "lon": lon,
                         "begin": p.get("archive_begin"), "end": p.get("archive_end"),
                         "awos": (p.get("attributes") or {}).get("IS_AWOS") == "1"})
    df = pd.DataFrame(rows).drop_duplicates("id")
    df["begin"] = pd.to_datetime(df["begin"], errors="coerce")
    df["end"] = pd.to_datetime(df["end"], errors="coerce")
    ok = (df["begin"] <= "2019-01-01") & (df["end"].isna() | (df["end"] >= "2025-12-31"))
    return df[ok].reset_index(drop=True)


def thunder_days(path: Path) -> int:
    a = pd.read_csv(path, usecols=["valid", "wxcodes"], dtype=str)
    ts = a[a["wxcodes"].fillna("").str.contains("TS")]
    return int(ts["valid"].str[:10].nunique())


def download(station: str, s) -> Path:
    dest = OUT / f"{station}.csv"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    params = [("station", station), ("data", "wxcodes"), ("year1", 2019), ("month1", 1), ("day1", 1),
              ("year2", 2026), ("month2", 1), ("day2", 1), ("tz", "Etc/UTC"), ("format", "onlycomma"),
              ("missing", "empty"), ("report_type", 3), ("report_type", 4)]
    for attempt in range(5):
        r = s.get(DATA, params=params, timeout=600)
        if r.status_code == 200:
            break
        time.sleep(30 * (attempt + 1))  # IEM asks clients to back off when busy
    r.raise_for_status()
    dest.write_text(r.text)
    time.sleep(2.0)
    return dest


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = PROCESSED / "sites.parquet"
    sites = pd.read_parquet(path)
    s = session("iem_cache")
    st = stations(s)
    print(f"{len(st)} ASOS/AWOS stations with 2019-2025 records ({(~st['awos']).sum()} full ASOS)")
    rows = []
    for site in sites.itertuples():
        d = haversine_km(site.lat, site.lon, st["lat"].to_numpy(), st["lon"].to_numpy())
        near = st.assign(km=d)[d <= MAX_KM].sort_values(["awos", "km"])  # full ASOS first, then nearest
        pick = None
        for c in near.itertuples():
            f = download(c.id, s)
            if not c.awos or thunder_days(f) >= AWOS_MIN_TS_DAYS:
                pick = c
                break
        if pick is None:
            rows.append({"site_id": site.site_id, "asos_station": None, "asos_dist_km": np.nan})
            print(site.site_id, "no station with thunder reports within", MAX_KM, "km", flush=True)
            continue
        rows.append({"site_id": site.site_id, "asos_station": pick.id, "asos_dist_km": round(float(pick.km), 1)})
        print(site.site_id, pick.id, pick.name, f"{pick.km:.1f} km", "AWOS" if pick.awos else "ASOS", flush=True)
    a = pd.DataFrame(rows)
    sites = sites.drop(columns=[c for c in a.columns if c != "site_id" and c in sites]).merge(a, on="site_id")
    sites.to_parquet(path, index=False)
    print(f"{sites['asos_station'].notna().sum()}/{len(sites)} sites with an ASOS station")


if __name__ == "__main__":
    main()
