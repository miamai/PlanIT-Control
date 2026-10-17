"""Row 10: GBIF sightings of alligators, venomous snakes and bears within 25 km, by month.

Species keys are looked up with GBIF's species-match API rather than hardcoded.
Output: data/raw/gbif/{site_id}.json and models/wildlife_sightings.parquet
        (site_id, group, month, count) used by the rule-based wildlife score.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import MODELS, PROCESSED, RAW, session  # noqa: E402

GROUPS = {
    "alligator": ["Alligator mississippiensis"],
    "venomous_snake": ["Crotalus", "Sistrurus", "Agkistrodon", "Micrurus fulvius", "Micrurus tener"],
    "bear": ["Ursus americanus", "Ursus arctos"],
}
YEARS = "2015,2025"
RADIUS_KM = 25
OUT = RAW / "gbif"


def taxon_key(name: str, s) -> int:
    r = s.get("https://api.gbif.org/v1/species/match",
              params={"name": name, "kingdom": "Animalia", "strict": "true"}, timeout=60)
    r.raise_for_status()
    d = r.json()
    # A fuzzy/higher-rank match can silently return e.g. "Animalia" (key 1); refuse those.
    if d.get("canonicalName") != name or d.get("rank") not in ("GENUS", "SPECIES"):
        raise RuntimeError(f"No exact GBIF match for {name}: {d.get('canonicalName')} ({d.get('rank')})")
    return int(d["usageKey"])


def monthly_counts(lat: float, lon: float, keys: list[int], s) -> dict[int, int]:
    params = [("taxonKey", k) for k in keys] + [
        ("geoDistance", f"{lat},{lon},{RADIUS_KM}km"), ("year", YEARS), ("hasCoordinate", "true"),
        ("occurrenceStatus", "PRESENT"), ("facet", "month"), ("facetLimit", 12), ("limit", 0),
    ]
    for attempt in range(8):
        r = s.get("https://api.gbif.org/v1/occurrence/search", params=params, timeout=120)
        if r.status_code != 429:
            break
        time.sleep(15 * (attempt + 1))  # GBIF throttles bursts
    r.raise_for_status()
    if not getattr(r, "from_cache", False):
        time.sleep(1.0)
    facets = r.json().get("facets", [])
    counts = {int(c["name"]): int(c["count"]) for f in facets for c in f["counts"]}
    return {m: counts.get(m, 0) for m in range(1, 13)}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    s = session("gbif_cache")
    keys = {g: [taxon_key(n, s) for n in names] for g, names in GROUPS.items()}
    print("taxon keys:", keys)
    sites = pd.read_parquet(PROCESSED / "sites.parquet")
    rows = []
    for site in sites.itertuples():
        res = {g: monthly_counts(site.lat, site.lon, k, s) for g, k in keys.items()}
        (OUT / f"{site.site_id}.json").write_text(json.dumps({"taxon_keys": keys, "counts": res}))
        for g, by_month in res.items():
            rows += [{"site_id": site.site_id, "group": g, "month": m, "count": c} for m, c in by_month.items()]
        print(site.site_id, {g: sum(v.values()) for g, v in res.items()})
    pd.DataFrame(rows).to_parquet(MODELS / "wildlife_sightings.parquet", index=False)


if __name__ == "__main__":
    main()
