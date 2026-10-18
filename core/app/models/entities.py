from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class HazardType(enum.StrEnum):
    WEATHER = "weather"
    HEAT = "heat"
    LIGHTNING = "lightning"
    FLOOD = "flood"
    WILDFIRE = "wildfire"
    SOIL = "soil"
    WILDLIFE = "wildlife"


class Severity(enum.StrEnum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlertStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    ALL_CLEAR_ELIGIBLE = "ALL_CLEAR_ELIGIBLE"
    RESOLVED = "RESOLVED"


class QualityStatus(enum.StrEnum):
    VERIFIED = "verified"
    PROVISIONAL = "provisional"
    STALE = "stale"
    ESTIMATED = "estimated"
    SYNTHETIC = "synthetic"


class UserRole(enum.StrEnum):
    USER = "user"
    ADMIN = "admin"


class UserStatus(enum.StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class UserAccount(Base):
    __tablename__ = "user_accounts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, native_enum=False, create_constraint=True, validate_strings=True), index=True
    )
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus, native_enum=False), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"
    __table_args__ = (Index("ix_refresh_sessions_user_expiry", "user_id", "expires_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_accounts.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_sites_latitude"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_sites_longitude"),
        Index("ix_sites_state_county", "state", "county"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    eia_plant_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    state: Mapped[str] = mapped_column(String(2), index=True)
    county: Mapped[str | None] = mapped_column(String(120))
    plant_type: Mapped[str | None] = mapped_column(String(255))
    primary_energy_source: Mapped[str | None] = mapped_column(String(32))
    operator_name: Mapped[str | None] = mapped_column(String(255))
    timezone: Mapped[str] = mapped_column(String(64))
    source_release: Mapped[str] = mapped_column(String(64))
    source_url: Mapped[str] = mapped_column(Text)
    source_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_reference_location: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    ml_site_id: Mapped[str | None] = mapped_column(String(80), unique=True)
    ml_model_version: Mapped[str | None] = mapped_column(String(120))

    @property
    def ml_supported(self) -> bool:
        return self.ml_site_id is not None


class HazardObservation(Base):
    __tablename__ = "hazard_observations"
    __table_args__ = (
        UniqueConstraint(
            "site_id",
            "source",
            "source_event_id",
            "metric_name",
            "observed_at",
            name="uq_observation_event",
        ),
        Index("ix_observations_site_time", "site_id", "observed_at"),
        Index("ix_observations_type_time", "hazard_type", "observed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    hazard_type: Mapped[HazardType] = mapped_column(Enum(HazardType, native_enum=False))
    source: Mapped[str] = mapped_column(String(80))
    source_event_id: Mapped[str] = mapped_column(String(255))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    metric_name: Mapped[str] = mapped_column(String(120))
    numeric_value: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(32))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    quality_status: Mapped[QualityStatus] = mapped_column(Enum(QualityStatus, native_enum=False))
    is_estimated: Mapped[bool] = mapped_column(Boolean, default=False)


class LightningStrike(Base):
    __tablename__ = "lightning_strikes"
    __table_args__ = (
        UniqueConstraint("provider", "strike_id", name="uq_lightning_provider_strike"),
        Index("ix_lightning_occurred_at", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    strike_id: Mapped[str] = mapped_column(String(255))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    provider: Mapped[str] = mapped_column(String(80))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint("source_reference", name="uq_alert_source_reference"),
        Index("ix_alerts_site_status", "site_id", "status"),
        Index("ix_alerts_triggered", "triggered_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    hazard_type: Mapped[HazardType] = mapped_column(Enum(HazardType, native_enum=False))
    severity: Mapped[Severity] = mapped_column(Enum(Severity, native_enum=False))
    status: Mapped[AlertStatus] = mapped_column(Enum(AlertStatus, native_enum=False))
    action_code: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    recommended_action: Mapped[str] = mapped_column(Text)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_reference: Mapped[str | None] = mapped_column(String(255))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AlertTransition(Base):
    __tablename__ = "alert_transitions"
    __table_args__ = (Index("ix_alert_transitions_alert_time", "alert_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"))
    from_status: Mapped[AlertStatus | None] = mapped_column(Enum(AlertStatus, native_enum=False))
    to_status: Mapped[AlertStatus] = mapped_column(Enum(AlertStatus, native_enum=False))
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    reason: Mapped[str] = mapped_column(Text)
    source_reference: Mapped[str | None] = mapped_column(String(255))


class LightningSiteState(Base):
    __tablename__ = "lightning_site_state"

    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True
    )
    alert_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"))
    latest_strike_id: Mapped[str] = mapped_column(String(255))
    latest_qualifying_strike_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    all_clear_eligible_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CrewReport(Base):
    __tablename__ = "crew_reports"
    __table_args__ = (Index("ix_reports_site_reported", "site_id", "reported_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    hazard_type: Mapped[HazardType] = mapped_column(Enum(HazardType, native_enum=False))
    description: Mapped[str] = mapped_column(Text)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    image_reference: Mapped[str | None] = mapped_column(Text)
    image_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reporter_subject: Mapped[str] = mapped_column(String(255), index=True)
    verification_status: Mapped[str] = mapped_column(String(32), default="unverified")


class CaptureSession(Base):
    """A guided photo report in progress: which checklist steps are done and what each showed."""

    __tablename__ = "capture_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    reporter_subject: Mapped[str] = mapped_column(String(255), index=True)
    hazard_type: Mapped[HazardType | None] = mapped_column(Enum(HazardType, native_enum=False))
    status: Mapped[str] = mapped_column(String(16), default="active")
    # item id -> {"status": "done" | "skipped", "text", "observation", "frame_ids"}
    steps: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    danger: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    frame_checks: Mapped[int] = mapped_column(Integer, default=0)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    report_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("crew_reports.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CaptureFrame(Base):
    """A photo kept as evidence for one checklist step. Retakes are never stored."""

    __tablename__ = "capture_frames"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("capture_sessions.id", ondelete="CASCADE"), index=True
    )
    item: Mapped[str] = mapped_column(String(32))
    image: Mapped[bytes] = mapped_column(LargeBinary)
    content_type: Mapped[str] = mapped_column(String(32))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    heading_deg: Mapped[float | None] = mapped_column(Float)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RiskScore(Base):
    __tablename__ = "risk_scores"
    __table_args__ = (
        CheckConstraint("score BETWEEN 0 AND 10", name="ck_risk_score_range"),
        UniqueConstraint("site_id", "prediction_date", "model_version", name="uq_risk_prediction"),
        Index("ix_risk_site_generated", "site_id", "generated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    score: Mapped[float] = mapped_column(Float)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    prediction_date: Mapped[date] = mapped_column(Date)
    valid_for_seconds: Mapped[int] = mapped_column(Integer)
    model_version: Mapped[str] = mapped_column(String(120))
    score_source: Mapped[str] = mapped_column(String(32))
    contributing_factors: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class SafetyBriefing(Base):
    __tablename__ = "safety_briefings"
    __table_args__ = (UniqueConstraint("site_id", "briefing_date", name="uq_briefing_site_date"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    briefing_date: Mapped[date] = mapped_column(Date)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    summary: Mapped[str] = mapped_column(Text)
    hazard_details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ProviderRun(Base):
    __tablename__ = "provider_runs"
    __table_args__ = (Index("ix_provider_runs_provider_started", "provider", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(String(80))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32))
    records_written: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    scope: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class EventOutbox(Base):
    __tablename__ = "event_outbox"
    __table_args__ = (Index("ix_event_outbox_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(80))
    site_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RiverStation(Base):
    __tablename__ = "river_stations"

    station_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    flood_stage: Mapped[float | None] = mapped_column(Float)
    flood_stage_unit: Mapped[str | None] = mapped_column(String(16))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)


class SiteRiverStation(Base):
    __tablename__ = "site_river_stations"

    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True
    )
    station_id: Mapped[str] = mapped_column(
        ForeignKey("river_stations.station_id", ondelete="CASCADE"), primary_key=True
    )
    distance_miles: Mapped[float] = mapped_column(Float)


class RateLimitWindow(Base):
    __tablename__ = "rate_limit_windows"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
