from pathlib import Path

import httpx
import pytest
from openpyxl import Workbook

from app.services.eia import (
    CACHE_PATH,
    fetch_eia_api_records,
    parse_cached_sites,
    parse_eia_workbook,
    select_reference_sites,
)

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


@pytest.mark.asyncio
async def test_api_loader_paginates_and_deduplicates_generators() -> None:
    fields = [{"id": field} for field in {
        "plant_id", "plant_name", "stateid", "county", "latitude", "longitude",
        "entity_name", "technology", "energy_source_code", "nameplate_capacity_mw", "status",
    }]
    pages = [
        [{"plant_id": "10", "plant_name": "Plant", "stateid": "TX", "county": "Test", "latitude": "30", "longitude": "-97", "entity_name": "Op", "technology": "Solar", "energy_source_code": "SUN", "nameplate_capacity_mw": "5", "status": "OP"},
         {"plant_id": "10", "plant_name": "Plant", "stateid": "TX", "county": "Test", "latitude": "30", "longitude": "-97", "entity_name": "Op", "technology": "Wind", "energy_source_code": "WND", "nameplate_capacity_mw": "10", "status": "OP"}],
        [{"plant_id": "11", "plant_name": "Other", "stateid": "TX", "county": "Test", "latitude": "31", "longitude": "-98", "entity_name": "Op", "technology": "Gas", "energy_source_code": "NG", "nameplate_capacity_mw": "1", "status": "IP"}],
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/operating-generator-capacity"):
            return httpx.Response(200, json={"response": {"data": fields}})
        offset = int(request.url.params.get("offset", "0"))
        page = pages[0] if offset == 0 else pages[1]
        return httpx.Response(200, json={"response": {"total": 3, "data": page}})

    records = await fetch_eia_api_records(
        "secret", page_size=2, transport=httpx.MockTransport(handler)
    )
    assert [record.eia_plant_id for record in records] == [10]
    assert records[0].plant_type == "Wind"
    assert select_reference_sites(records, per_state=3, maximum=153) == records
