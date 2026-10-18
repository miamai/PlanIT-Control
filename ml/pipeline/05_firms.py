"""Row 5: NASA FIRMS VIIRS (S-NPP) yearly USA country files, 2019-2025.

Raw CSVs are kept untouched; labels.py filters to type == 0 (vegetation fire).
Output: data/raw/firms/viirs-snpp_{year}_United_States.csv
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import RAW, YEARS, download  # noqa: E402

URL = "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/{year}/viirs-snpp_{year}_United_States.csv"


def main() -> None:
    for year in YEARS:
        dest = download(URL.format(year=year), RAW / "firms" / f"viirs-snpp_{year}_United_States.csv")
        print(f"{dest.name}: {dest.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
