"""Row 7: FEMA flood zone at each site (one point query per site).

FEMA's own NFHL server is tried first; when it refuses the connection we fall back to
Esri's Living Atlas copy of the same layer (USA Flood Hazard Reduced Set).
Adds fema_zone, fema_sfha, fema_coastal, fema_source to data/processed/sites.parquet.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import BROWSER_UA, PROCESSED, RAW  # noqa: E402

SOURCES = {
    "fema_nfhl": "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
    "esri_living_atlas": ("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/"
                          "USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0/query"),
}


def query(lat: float, lon: float) -> tuple[str | None, str | None, str]:
    params = {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
        "returnGeometry": "false", "f": "json",
    }
    for name, url in SOURCES.items():
        try:
            r = requests.get(url, params=params, timeout=30, headers={"User-Agent": BROWSER_UA})
            r.raise_for_status()
            feats = r.json().get("features", [])
        except (requests.RequestException, ValueError):
            continue
        if not feats:
            return None, None, name
        # A point can touch several polygons; take the most hazardous (SFHA first).
        attrs = sorted((f["attributes"] for f in feats), key=lambda a: a.get("SFHA_TF") != "T")[0]
        return attrs.get("FLD_ZONE"), attrs.get("SFHA_TF"), name
    raise RuntimeError("No FEMA flood-zone source reachable")


def main() -> None:
    path = PROCESSED / "sites.parquet"
    sites = pd.read_parquet(path)
    rows = []
    for s in sites.itertuples():
        zone, sfha, src = query(s.lat, s.lon)
        rows.append({"site_id": s.site_id, "fema_zone": zone or "unmapped/X",
                     "fema_sfha": float(sfha == "T"),
                     "fema_coastal": float(bool(zone) and zone.startswith("V")),
                     "fema_source": src})
        print(s.site_id, zone, sfha, src)
    fema = pd.DataFrame(rows)
    fema.to_csv(RAW / "fema_zones.csv", index=False)
    sites = sites.drop(columns=[c for c in fema.columns if c != "site_id" and c in sites]).merge(fema, on="site_id")
    sites.to_parquet(path, index=False)
    print(sites["fema_zone"].value_counts().to_string())


if __name__ == "__main__":
    main()
