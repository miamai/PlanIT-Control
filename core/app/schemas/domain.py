from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

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


class RiskRanking(BaseModel):
    site: SiteRead
    risk: RiskRead | None
    status: str


class BriefingRead(ORMModel):
    id: uuid.UUID
    site_id: uuid.UUID
    briefing_date: date
    generated_at: datetime
    summary: str
    hazard_details: dict[str, Any]


class AlertUpdate(BaseModel):
    status: AlertStatus
    reason: str = Field(min_length=3, max_length=1000)


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
