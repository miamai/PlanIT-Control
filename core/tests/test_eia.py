from pathlib import Path

from openpyxl import Workbook

from app.services.eia import CACHE_PATH, parse_cached_sites, parse_eia_workbook

HEADERS = [
    "Entity Name",
    "Plant ID",
    "Plant Name",
    "Plant State",
    "County",
    "Technology",
    "Energy Source Code",
    "Nameplate Capacity (MW)",
    "Latitude",
    "Longitude",
]


def test_cached_dataset_contains_authentic_unique_sites() -> None:
    sites = parse_cached_sites(CACHE_PATH)
    ids = {site.eia_plant_id for site in sites}
    assert len(sites) >= 50
    assert len(ids) == len(sites)
    assert all(-90 <= site.latitude <= 90 and -180 <= site.longitude <= 180 for site in sites)


def test_workbook_parser_uses_real_headers_and_deduplicates(tmp_path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Operating"
    sheet.append(["Inventory of Operating Generators as of Test Release"])
    sheet.append([])
    sheet.append(HEADERS)
    sheet.append(["Operator", 10, "Plant", "TX", "County", "Solar", "SUN", 5, 30, -97])
    sheet.append(["Operator", 10, "Plant", "TX", "County", "Wind", "WND", 10, 30, -97])
    sheet.append(["Invalid", 11, "Bad", "TX", "County", "Solar", "SUN", 1, None, None])
    path = tmp_path / "eia.xlsx"
    workbook.save(path)

    records = parse_eia_workbook(path)
    assert len(records) == 1
    assert records[0].eia_plant_id == 10
    assert records[0].plant_type == "Wind"
    assert records[0].primary_energy_source == "WND"
