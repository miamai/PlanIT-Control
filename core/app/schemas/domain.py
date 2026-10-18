from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.entities import (
    AlertStatus,
    HazardType,
    QualityStatus,
    Severity,
    UserRole,
    UserStatus,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _score_severity(value: Any) -> Literal["LOW", "MODERATE", "HIGH", "CRITICAL", "UNKNOWN"]:
    if not isinstance(value, (int, float)):
        return "UNKNOWN"
    if value >= 7.5:
        return "CRITICAL"
    if value >= 5:
        return "HIGH"
    if value >= 2.5:
        return "MODERATE"
    return "LOW"


class PageMeta(BaseModel):
    limit: int
    offset: int
    total: int


class FeedMeta(PageMeta):
    states: list[str]
    data_mode: str
    last_successful_ingestion: datetime | None = None
    last_run_status: str | None = None


class Envelope[T](BaseModel):
    data: T
    meta: FeedMeta | PageMeta | dict[str, Any] | None = None


class SiteRead(ORMModel):
    id: uuid.UUID
    eia_plant_id: int
    name: str
    latitude: float
    longitude: float
    state: str
    county: str | None
    plant_type: str | None
    primary_energy_source: str | None
    operator_name: str | None
    timezone: str
    source_release: str
    source_url: str
    is_reference_location: bool
    created_at: datetime
    updated_at: datetime
    ml_supported: bool
    ml_site_id: str | None
    ml_model_version: str | None


class ObservationRead(ORMModel):
    id: uuid.UUID
    site_id: uuid.UUID
    hazard_type: HazardType
    source: str
    source_event_id: str
    observed_at: datetime
    valid_until: datetime | None
    ingested_at: datetime
    metric_name: str
    numeric_value: float | None
    unit: str | None
    latitude: float | None
    longitude: float | None
    quality_status: QualityStatus
    is_estimated: bool
    metadata_: dict[str, Any] = Field(serialization_alias="metadata")
    severity: Literal["LOW", "MODERATE", "HIGH", "CRITICAL", "UNKNOWN"] = "UNKNOWN"
    severity_basis: str = "No severity assessment was provided"


class SiteObservationRead(BaseModel):
    site: SiteRead
    observation: ObservationRead


class UserRead(ORMModel):
    id: uuid.UUID
    username: str
    display_name: str | None
    role: UserRole
    status: UserStatus
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=120)
    role: UserRole


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    role: UserRole | None = None
    status: UserStatus | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)


class AlertRead(ORMModel):
    id: uuid.UUID
    site_id: uuid.UUID
    hazard_type: HazardType
    severity: Severity
    status: AlertStatus
    action_code: str | None
    title: str
    message: str
    recommended_action: str
    triggered_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    expires_at: datetime | None
    source_reference: str | None
    details: dict[str, Any]


class CrewReportCreate(BaseModel):
    site_id: uuid.UUID
    hazard_type: HazardType
    description: str = Field(min_length=3, max_length=2000)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    image_reference: str | None = Field(default=None, max_length=2048)
    image_metadata: dict[str, Any] = Field(default_factory=dict)
    observed_at: datetime | None = None

    @field_validator("observed_at")
    @classmethod
    def timestamp_must_include_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("observed_at must include a timezone")
        return value


class CrewReportUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(min_length=3, max_length=2000)

    @field_validator("description")
    @classmethod
    def nonblank_description(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("description must contain at least three non-whitespace characters")
        return value


class CrewReportRead(ORMModel):
    id: uuid.UUID
    site_id: uuid.UUID
    hazard_type: HazardType
    description: str
    latitude: float
    longitude: float
    image_reference: str | None
    image_metadata: dict[str, Any]
    reported_at: datetime
    reporter_subject: str
    verification_status: str


# Base64 JPEG/PNG; the client downsizes frames to ~1024 px, well under this.
CaptureImage = Annotated[str, Field(min_length=16, max_length=2_800_000)]


class CaptureStart(BaseModel):
    site_id: uuid.UUID
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class CaptureFrameCreate(BaseModel):
    item: str = Field(pattern=r"^[a-z_]{1,32}$")
    images: list[CaptureImage] = Field(min_length=1, max_length=2)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    heading_deg: float | None = Field(default=None, ge=0, lt=360)


class CaptureHazardChoice(BaseModel):
    hazard_type: HazardType


class CaptureSkip(BaseModel):
    item: str = Field(pattern=r"^[a-z_]{1,32}$")


class CaptureSubmit(BaseModel):
    description: str = Field(min_length=3, max_length=2000)


class CaptureStepRead(BaseModel):
    item: str
    instruction: str
    frames: int = Field(ge=1, le=2)


class CaptureChecklistItemRead(CaptureStepRead):
    status: Literal["pending", "done", "skipped"]
    text: str | None = None


class CaptureDangerRead(BaseModel):
    code: str
    instruction: str
    summary: str


class CaptureSessionRead(BaseModel):
    id: uuid.UUID
    site_id: uuid.UUID
    hazard_type: HazardType | None
    status: Literal["active", "stopped", "submitted"]
    guided: bool = Field(description="Whether the hazard has a guided checklist")
    next_step: CaptureStepRead | None
    checklist: list[CaptureChecklistItemRead]
    draft: str
    danger: CaptureDangerRead | None
    report_id: uuid.UUID | None


class CaptureFeedback(BaseModel):
    item: str
    satisfied: bool
    text: str | None
    hint: str | None
    hazard_guess: HazardType | None
    confidence: float | None


class CaptureFrameResult(BaseModel):
    session: CaptureSessionRead
    feedback: CaptureFeedback


class RiskDriverRead(BaseModel):
    hazard: str
    severity: Literal["LOW", "MODERATE", "HIGH", "CRITICAL", "UNKNOWN"]
    impact: float = Field(gt=0)
    explanation: str
    value: float | None = None
    explanation_method: Literal["tree_shap", "rule_based"]


class RiskRead(ORMModel):
    id: uuid.UUID
    site_id: uuid.UUID
    score: float
    generated_at: datetime
    prediction_date: date
    valid_for_seconds: int
    model_version: str
    score_source: str
    contributing_factors: dict[str, Any]
    top_drivers: list[RiskDriverRead] = Field(default_factory=list)

    @classmethod
    def from_score(cls, score: Any) -> RiskRead:
        result = cls.model_validate(score)
        factors = score.contributing_factors or {}
        sub_scores = factors.get("sub_scores") or {}
        drivers = []
        for reason in factors.get("reasons") or []:
            if not isinstance(reason, dict):
                continue
            hazard = reason.get("hazard")
            impact = reason.get("impact")
            explanation = reason.get("text")
            if not isinstance(hazard, str) or not isinstance(explanation, str):
                continue
            if not isinstance(impact, (int, float)) or impact <= 0:
                continue
            method = reason.get("explanation_method")
            if method not in {"tree_shap", "rule_based"}:
                # Older stored ML results predate the explicit method field, but
                # their producer is known: model features are TreeSHAP and the
                # wildlife category is the documented rule-based exception.
                if score.score_source == "ml_service":
                    method = "rule_based" if hazard == "wildlife" else "tree_shap"
                else:
                    continue
            sub_score = sub_scores.get(hazard)
            severity = _score_severity(sub_score)
            value = reason.get("value")
            drivers.append(
                RiskDriverRead(
                    hazard=hazard,
                    severity=severity,
                    impact=float(impact),
                    explanation=explanation,
                    value=float(value) if isinstance(value, (int, float)) else None,
                    explanation_method=method,
                )
            )
        drivers.sort(key=lambda driver: driver.impact, reverse=True)
        return result.model_copy(update={"top_drivers": drivers[:3]})


class RiskPredictionCreate(BaseModel):
    site_id: uuid.UUID
    score: float = Field(ge=0, le=10)
    generated_at: datetime
    prediction_date: date
    valid_for_seconds: int = Field(gt=0, le=604800)
    model_version: str = Field(min_length=1, max_length=120)
    contributing_factors: dict[str, Any] = Field(default_factory=dict)

    @field_validator("model_version")
    @classmethod
    def reject_demo_model(cls, value: str) -> str:
        if "demo" in value.lower():
            raise ValueError("Model predictions must identify a real model version")
        return value


class RiskResult(BaseModel):
    site_id: uuid.UUID
    status: str
    score: RiskRead | None
    decision: Literal["GO", "CAUTION", "NO_GO", "REVIEW_REQUIRED"]
    decision_basis: list[str]
    operational_authorization: Literal["NOT_GRANTED"] = "NOT_GRANTED"


class RiskRanking(BaseModel):
    site: SiteRead
    risk: RiskRead | None
    status: str
    decision: Literal["GO", "CAUTION", "NO_GO", "REVIEW_REQUIRED"]
    decision_basis: list[str]
    operational_authorization: Literal["NOT_GRANTED"] = "NOT_GRANTED"


class BriefingRead(ORMModel):
    id: uuid.UUID
    site_id: uuid.UUID
    briefing_date: date
    generated_at: datetime
    summary: str
    hazard_details: dict[str, Any]


class NormalizedObservation(BaseModel):
    site_id: uuid.UUID
    hazard_type: HazardType
    source: str
    source_event_id: str
    observed_at: datetime
    valid_until: datetime | None = None
    metric_name: str
    numeric_value: float | None = None
    unit: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    metadata: dict[str, Any] = Field(default_factory=dict)
    quality_status: QualityStatus = QualityStatus.PROVISIONAL
    is_estimated: bool = False


class LightningStrikeInput(BaseModel):
    strike_id: str = Field(min_length=1, max_length=255)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    occurred_at: datetime
    provider: str = Field(min_length=1, max_length=80)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("occurred_at")
    @classmethod
    def aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("occurred_at must include a timezone")
        return value


class AlertUpdate(BaseModel):
    status: AlertStatus
    reason: str = Field(min_length=3, max_length=1000)
