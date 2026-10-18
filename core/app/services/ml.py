from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import date
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.entities import Alert, CrewReport, Site

EIA_SOURCE_URL = "https://www.eia.gov/electricity/data/eia860m/"


class MLHealth(BaseModel):
    ok: bool
    models_ready: bool
    model_version: str
    site_count: int = Field(ge=1)


class MLSite(BaseModel):
    model_config = ConfigDict(extra="ignore")

    site_id: str = Field(pattern=r"^EIA-\d+$")
    name: str
    state: str = Field(min_length=2, max_length=2)
    county: str | None = None
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    timezone: str
    region: str | None = None
    technology: str | None = None
    capacity_mw: float | None = None
    model_version: str

    @property
    def eia_plant_id(self) -> int:
        return int(self.site_id.removeprefix("EIA-"))


class MLRisk(BaseModel):
    model_config = ConfigDict(extra="ignore")

    site_id: str
    date: date
    hazard_index: float = Field(ge=0, le=10)
    recommendation: Literal["go", "caution", "no-go"]
    sub_scores: dict[str, float]
    reasons: list[dict[str, Any]] = Field(default_factory=list)
    work_plan: dict[str, Any] = Field(default_factory=dict)
    overrides: list[dict[str, Any]] = Field(default_factory=list)
    model_version: str
    mock: bool = False

    @field_validator("hazard_index")
    @classmethod
    def finite_index(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("hazard index must be finite")
        return value

    @field_validator("sub_scores")
    @classmethod
    def valid_sub_scores(cls, values: dict[str, float]) -> dict[str, float]:
        if any(not math.isfinite(v) or not 0 <= v <= 10 for v in values.values()):
            raise ValueError("sub-scores must be finite and between 0 and 10")
        return values

    def contributing_factors(self) -> dict[str, Any]:
        """The stored `RiskScore.contributing_factors` for this prediction."""
        return {
            "recommendation": self.recommendation,
            "sub_scores": self.sub_scores,
            "reasons": self.reasons,
            "work_plan": self.work_plan,
            "overrides": self.overrides,
            "ml_site_id": self.site_id,
            "coverage": "supported",
            "prediction_date": self.date.isoformat(),
        }


class MLBriefing(BaseModel):
    risk: MLRisk
    briefing: str = Field(min_length=1, max_length=5000)
    source: str = Field(min_length=1, max_length=200)
    facts: str | None = None
    tried: list[dict[str, Any]] = Field(default_factory=list)


class MLCaptureStep(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[a-z_]{1,32}$")
    instruction: str = Field(min_length=1, max_length=300)
    frames: int = Field(ge=1, le=2)


class MLCaptureChecklists(BaseModel):
    identify: MLCaptureStep
    hazards: dict[str, list[MLCaptureStep]]


class MLCaptureDanger(BaseModel):
    code: str = Field(max_length=40)
    hazard: str
    instruction: str = Field(max_length=300)
    summary: str = Field(max_length=200)


class MLObservation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    item: str
    satisfied: bool
    observation: dict[str, Any] = Field(default_factory=dict)
    text: str | None = Field(default=None, max_length=300)
    hint: str | None = None
    hint_text: str | None = Field(default=None, max_length=300)
    danger: MLCaptureDanger | None = None
    hazard_guess: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: str = ""


class MLClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = settings.ml_base_url.rstrip("/")
        self.timeout = settings.ml_timeout_seconds
        self.backend = settings.ml_briefing_backend
        self.transport = transport

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        async with httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout, transport=self.transport
        ) as client:
            response = await client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json()

    async def health(self) -> MLHealth:
        return MLHealth.model_validate(await self._request("GET", "/health"))

    async def sites(self) -> list[MLSite]:
        return [MLSite.model_validate(row) for row in await self._request("GET", "/sites")]

    async def briefing(
        self,
        site: Site,
        prediction_date: date,
        alerts: list[Alert],
        reports: list[CrewReport],
    ) -> MLBriefing:
        raw = await self._request(
            "POST",
            "/briefing",
            params={"backend": self.backend},
            json=_request_payload(site, prediction_date, alerts, reports),
        )
        result = MLBriefing.model_validate(raw)
        _check_risk(site, prediction_date, result.risk)
        return result

    async def score(
        self,
        site: Site,
        prediction_date: date,
        alerts: Sequence[Alert] = (),
        reports: Sequence[CrewReport] = (),
    ) -> MLRisk:
        """Hazard index only, no briefing. The service accepts dates up to ~2 weeks back."""
        raw = await self._request(
            "POST", "/score", json=_request_payload(site, prediction_date, alerts, reports)
        )
        risk = MLRisk.model_validate(raw)
        _check_risk(site, prediction_date, risk)
        return risk

    async def capture_checklists(self) -> MLCaptureChecklists:
        return MLCaptureChecklists.model_validate(await self._request("GET", "/capture/checklists"))

    async def observe(
        self, hazard: str | None, item: str, images: list[str], heading_deg: float | None
    ) -> MLObservation:
        raw = await self._request(
            "POST",
            "/capture/observe",
            json={"hazard": hazard, "item": item, "images": images, "heading_deg": heading_deg},
        )
        result = MLObservation.model_validate(raw)
        if result.item != item:
            raise ValueError("ML observation does not match the requested step")
        return result


def _request_payload(
    site: Site,
    prediction_date: date,
    alerts: Sequence[Alert],
    reports: Sequence[CrewReport],
) -> dict[str, Any]:
    if not site.ml_site_id or not site.ml_model_version:
        raise ValueError("Site does not have ML coverage")
    return {
        "site_id": site.ml_site_id,
        "date": prediction_date.isoformat(),
        "alerts": [
            {
                "type": alert.hazard_type.value,
                "action": alert.action_code or _severity_action(alert.severity.value),
                "message": alert.message[:500],
            }
            for alert in alerts
        ],
        "crew_reports": [_report_payload(report) for report in reports],
    }


def _check_risk(site: Site, prediction_date: date, risk: MLRisk) -> None:
    if risk.mock:
        raise ValueError("ML service returned a mock prediction")
    if risk.site_id != site.ml_site_id or risk.date != prediction_date:
        raise ValueError("ML response site/date does not match the request")
    if risk.model_version != site.ml_model_version:
        raise ValueError("ML response model version does not match the site catalog")


def _severity_action(severity: str) -> str:
    if severity.upper() in {"HIGH", "CRITICAL"}:
        return "no-go"
    if severity.upper() == "MODERATE":
        return "caution"
    return ""


def _report_payload(report: CrewReport) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "hazard_type": report.hazard_type.value,
        "description": report.description,
        "reported_at": report.reported_at.isoformat(),
        "verification_status": report.verification_status,
    }
    return payload


async def sync_ml_sites(session: AsyncSession, client: MLClient) -> int:
    catalog = await client.sites()
    if not catalog:
        raise ValueError("ML site catalog is empty")
    health = await client.health()
    if len(catalog) != health.site_count:
        raise ValueError("ML site catalog size does not match service health")
    if any(row.model_version != health.model_version for row in catalog):
        raise ValueError("ML site catalog version does not match service health")
    count = 0
    for row in catalog:
        site = await session.scalar(select(Site).where(Site.eia_plant_id == row.eia_plant_id))
        if site is None:
            site = Site(
                eia_plant_id=row.eia_plant_id,
                name=row.name,
                latitude=row.lat,
                longitude=row.lon,
                state=row.state,
                county=row.county,
                plant_type=row.technology,
                primary_energy_source=None,
                operator_name=None,
                timezone=row.timezone,
                source_release=f"ML catalog {row.model_version}",
                source_url=EIA_SOURCE_URL,
                source_metadata={"region": row.region, "capacity_mw": row.capacity_mw},
                is_reference_location=True,
            )
            session.add(site)
        site.ml_site_id = row.site_id
        site.ml_model_version = row.model_version
        count += 1
    await session.commit()
    return count
