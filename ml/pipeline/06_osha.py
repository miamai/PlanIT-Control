"""Row 6: OSHA Severe Injury Reports (full CSV with lat/lon).

Output: data/raw/osha.csv
"""

from __future__ import annotations

import io
import re
import sys
import zipfile
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import BROWSER_UA, RAW  # noqa: E402

PAGE = "https://www.osha.gov/severe-injury-reports"


def main() -> None:
    dest = RAW / "osha.csv"
    if dest.exists():
        print(f"{dest} exists")
        return
    headers = {"User-Agent": BROWSER_UA}
    html = requests.get(PAGE, timeout=60, headers=headers).text
    hrefs = re.findall(r'href="([^"]*\.(?:zip|csv))"', html)
    if not hrefs:
        raise RuntimeError("No OSHA download link found")
    url = "https://www.osha.gov" + hrefs[0] if hrefs[0].startswith("/") else hrefs[0]
    r = requests.get(url, timeout=300, headers=headers)
    r.raise_for_status()
    if url.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
            dest.write_bytes(z.read(name))
    else:
        dest.write_bytes(r.content)
    print(f"{url} -> {dest}")


if __name__ == "__main__":
    main()
