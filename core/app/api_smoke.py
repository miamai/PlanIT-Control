from __future__ import annotations

import argparse
import getpass
import json
import os
from datetime import UTC, datetime

import httpx


def _expect(response: httpx.Response, expected: int = 200) -> dict:
    if response.status_code != expected:
        raise RuntimeError(
            f"{response.request.method} {response.request.url.path} returned "
            f"{response.status_code}: {response.text[:500]}"
        )
    return response.json()


def run(
    base_url: str,
    username: str,
    password: str,
    write_checks: bool = False,
) -> dict:
    results: dict[str, object] = {}
    with httpx.Client(base_url=base_url.rstrip("/"), timeout=15) as client:
        results["health"] = _expect(client.get("/health"))
        login = _expect(
            client.post("/api/auth/login", json={"username": username, "password": password})
        )
        token = login["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"
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
            _expect(client.get("/api/alerts", params={"site_id": site_id, "limit": 5}))["data"]
        )
        results["risk_status"] = _expect(client.get(f"/api/sites/{site_id}/risk"))["data"]["status"]
        results["briefings"] = len(
            _expect(client.get("/api/briefings", params={"limit": 5}))["data"]
        )
        results["rankings"] = len(_expect(client.get("/api/risk/rankings"))["data"])
        results["feeds"] = {}
        payload = _expect(
            client.get(
                "/api/sites/lightning",
                params=[("state", site["state"]), ("limit", "2")],
            )
        )
        if payload["meta"]["states"] != [site["state"]]:
            raise RuntimeError("lightning feed did not preserve the requested state scope")
        results["feeds"]["lightning"] = payload["meta"]["total"]

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
    parser.add_argument("--username", default=os.getenv("PLANIT_SMOKE_USERNAME"))
    parser.add_argument(
        "--write-checks",
        action="store_true",
        help="Also submit one explicitly synthetic crew report",
    )
    args = parser.parse_args()
    if not args.username:
        parser.error("--username or PLANIT_SMOKE_USERNAME is required")
    password = os.getenv("PLANIT_SMOKE_PASSWORD") or getpass.getpass("PlanIT password: ")
    try:
        result = run(
            args.base_url,
            args.username,
            password,
            args.write_checks,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        raise SystemExit(1) from exc
    print(json.dumps({"ok": True, "checks": result}, indent=2, default=str))
