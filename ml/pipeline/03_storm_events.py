"""Row 3: NOAA Storm Events detail files, 2019-2025.

Output: data/raw/storm_events/StormEvents_details-*.csv.gz
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import RAW, UA, YEARS, download  # noqa: E402

BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"


def main() -> None:
    listing = requests.get(BASE, timeout=60, headers={"User-Agent": UA}).text
    for year in YEARS:
        names = sorted(set(re.findall(rf"StormEvents_details-ftp_v1\.0_d{year}_c\d+\.csv\.gz", listing)))
        if not names:
            raise RuntimeError(f"No Storm Events file for {year}")
        name = names[-1]  # latest revision
        download(BASE + name, RAW / "storm_events" / name)
        print(name)


if __name__ == "__main__":
    main()
