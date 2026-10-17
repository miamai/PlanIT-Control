"""NWS watch/warning/advisory archive (VTEC) at each site, 2019-2025, from the Iowa Environmental Mesonet.

One request per site returns every product whose polygon or zone covered the site's point:
heat advisories/warnings, severe thunderstorm and tornado warnings, flood and flash flood
warnings, red flag warnings, and so on. labels.py decides which ones count for which hazard.

Output: data/raw/iem_warnings/{site_id}.parquet
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import PROCESSED, RAW, session  # noqa: E402

URL = "https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py"
OUT = RAW / "iem_warnings"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sites = pd.read_parquet(PROCESSED / "sites.parquet")
    s = session("iem_cache")
    for site in sites.itertuples():
        dest = OUT / f"{site.site_id}.parquet"
        if dest.exists():
            continue
        r = s.get(URL, params={"lat": round(site.lat, 4), "lon": round(site.lon, 4),
                               "sdate": "2019-01-01", "edate": "2026-01-01"}, timeout=180)
        r.raise_for_status()
        ev = pd.DataFrame(r.json().get("events", []))
        cols = ["phenomena", "significance", "name", "issue", "expire", "wfo", "eventid", "ugc"]
        ev = ev.reindex(columns=cols)
        ev["issue"] = pd.to_datetime(ev["issue"], utc=True)
        ev["expire"] = pd.to_datetime(ev["expire"], utc=True)
        ev.to_parquet(dest, index=False)
        print(site.site_id, len(ev), "products", flush=True)
        if not getattr(r, "from_cache", False):
            time.sleep(1.0)  # be polite to IEM


if __name__ == "__main__":
    main()
