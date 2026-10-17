"""Row 4: NWS public forecast zone <-> county lookup (pipe-delimited .dbx).

Output: data/raw/zone_county.dbx
"""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import BROWSER_UA, RAW, download  # noqa: E402

PAGE = "https://www.weather.gov/gis/ZoneCounty"


def main() -> None:
    html = requests.get(PAGE, timeout=60, headers={"User-Agent": BROWSER_UA}).text
    links = set(re.findall(r'href="([^"]*/bp(\d{2}[a-z]{2}\d{2})\.dbx)"', html))
    if not links:
        raise RuntimeError("No zone-county .dbx link found")
    # Files are named bpDDmonYY, e.g. bp16ap26; pick the newest.
    def when(code: str) -> datetime:
        months = {"ja": 1, "fe": 2, "mr": 3, "ap": 4, "my": 5, "jn": 6, "jl": 7,
                  "au": 8, "se": 9, "oc": 10, "no": 11, "de": 12}
        return datetime(2000 + int(code[4:]), months.get(code[2:4], 1), int(code[:2]))

    href, code = max(links, key=lambda x: when(x[1]))
    url = "https://www.weather.gov" + href if href.startswith("/") else href
    dest = RAW / "zone_county.dbx"
    dest.unlink(missing_ok=True)
    download(url, dest, headers={"User-Agent": BROWSER_UA})
    print(f"{url} -> {dest}")


if __name__ == "__main__":
    main()
