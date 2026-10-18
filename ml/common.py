"""Shared paths, HTTP session and small geo helpers for the pipeline scripts."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import requests
import requests_cache

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
MODELS = ROOT / "models"

YEARS = list(range(2019, 2026))
TRAIN_YEARS = list(range(2019, 2024))
CALIB_YEAR = 2024
TEST_YEAR = 2025

HAZARDS = ["heat", "convective", "flood", "wildfire"]

UA = "Precognition-ML/0.1 (hackathon research; contact via github)"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

for d in (RAW, PROCESSED, MODELS):
    d.mkdir(parents=True, exist_ok=True)


def session(cache_name: str = "http_cache", expire_after: int = -1) -> requests.Session:
    """A cached session so re-running a script doesn't hit APIs again."""
    s = requests_cache.CachedSession(
        str(RAW / cache_name),
        backend="sqlite",
        expire_after=expire_after,
        allowable_codes=(200,),
    )
    s.headers["User-Agent"] = UA
    return s


def download(url: str, dest: Path, headers: dict | None = None, chunk: int = 1 << 20) -> Path:
    """Stream a file to disk; skip if it already exists."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=120, headers=headers or {"User-Agent": UA}) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for block in r.iter_content(chunk):
                f.write(block)
    tmp.rename(dest)
    return dest


EARTH_KM = 6371.0088
MILES_25_KM = 40.2336


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km. Broadcasts over numpy arrays."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(a))


def nearest(lat, lon, lats, lons):
    """Index and distance (km) of the nearest point in (lats, lons)."""
    d = haversine_km(lat, lon, np.asarray(lats), np.asarray(lons))
    i = int(np.nanargmin(d))
    return i, float(d[i])
