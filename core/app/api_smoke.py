from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

import httpx


def _expect(response: httpx.Response, expected: int = 200) -> dict:
    if response.status_code != expected:
        raise RuntimeError(
            f"{response.request.method} {response.request.url.path} returned "
            f"{response.status_code}: {response.text[:500]}"
        )
    return response.json()


def run(base_url: str, write_checks: bool = False) -> dict:
    headers = {
        "X-PlanIT-Role": "admin",
        "X-PlanIT-Subject": "api-smoke-check",
    }
    results: dict[str, object] = {}
    with httpx.Client(base_url=base_url.rstrip("/"), headers=headers, timeout=15) as client:
        results["health"] = _expect(client.get("/health"))
        sites_payload = _expect(client.get("/api/sites", params={"limit": 1}))
        if not sites_payload["data"]:
            raise RuntimeError(
                "No sites are available. Run planit-import-sites or planit-seed-demo first."
            )
        site = sites_payload["data"][0]
        site_id = site["id"]
        results["site"] = _expect(client.get(f"/api/sites/{site_id}"))["data"]["name"]
        results["hazards"] = len(
            _expect(client.get(f"/api/sites/{site_id}/hazards", params={"limit": 5}))["data"]
        )
        results["alerts"] = len(
            _expect(client.get(f"/api/sites/{site_id}/alerts", params={"limit": 5}))["data"]
        )
        results["risk_status"] = _expect(client.get(f"/api/sites/{site_id}/risk"))["data"]["status"]
        results["briefings"] = len(_expect(client.get(f"/api/sites/{site_id}/briefings"))["data"])
        results["rankings"] = len(_expect(client.get("/api/risk/rankings"))["data"])
        results["system_ok"] = _expect(client.get("/api/admin/system"))["data"]["ok"]

        if write_checks:
            report = _expect(
                client.post(
                    "/api/reports",
                    json={
                        "site_id": site_id,
                        "hazard_type": "wildlife",
                        "description": "Synthetic API smoke-check wildlife report",
                        "latitude": site["latitude"],
                        "longitude": site["longitude"],
                        "observed_at": datetime.now(UTC).isoformat(),
                        "image_metadata": {"synthetic_notice": True},
                    },
                ),
                expected=201,
            )
            results["report_id"] = report["data"]["id"]

        with client.stream("GET", "/api/stream", headers={"Last-Event-ID": "0"}) as response:
            if response.status_code != 200:
                raise RuntimeError(f"SSE stream returned {response.status_code}")
            first_line = next(response.iter_lines())
            results["sse"] = "connected" if first_line else "connected"
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-check a running PlanIT API")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument(
        "--write-checks",
        action="store_true",
        help="Also submit one explicitly synthetic crew report",
    )
    args = parser.parse_args()
    try:
        result = run(args.base_url, args.write_checks)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        raise SystemExit(1) from exc
    print(json.dumps({"ok": True, "checks": result}, indent=2, default=str))
