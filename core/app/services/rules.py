from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.models.entities import (
    Alert,
    AlertStatus,
    AlertTransition,
    HazardObservation,
    Severity,
)
from app.services.events import publish_event
from app.services.hazard_severity import alert_severity, assess_observation


def _rule_for(
    observation: HazardObservation, settings: Settings
) -> tuple[Severity, str, str] | None:
    metadata = observation.metadata_ or {}
    if observation.metric_name == "official_alert":
        severity = alert_severity(assess_observation(observation, settings))
        if severity is None:
            severity = Severity.MODERATE
        return (
            severity,
            str(metadata.get("headline") or metadata.get("event") or "Official warning"),
            (
                str(
                    metadata.get("instruction")
                    or "Review the official warning and site safety plan."
                )
            ),
        )
    if settings.alert_threshold_profile == "disabled":
        return None
    if observation.metric_name == "calculated_heat_index" and observation.numeric_value is not None:
        severity = alert_severity(assess_observation(observation, settings))
        if severity == Severity.CRITICAL:
            return Severity.CRITICAL, "Extreme demo heat threshold", "Use the approved heat plan."
        if severity == Severity.HIGH:
            return Severity.HIGH, "Dangerous demo heat threshold", "Increase heat controls."
    if observation.metric_name == "satellite_active_fire_detection":
        distance = float(metadata.get("distance_miles", 999))
        if distance <= settings.wildfire_radius_miles:
            return (
                Severity.HIGH,
                "Nearby satellite active-fire detection",
                "Review official fire and evacuation information; this detection is not an evacuation order.",
            )
    if (
        observation.metric_name == "soil_saturation_risk_proxy"
        and observation.numeric_value is not None
    ):
        severity = alert_severity(assess_observation(observation, settings))
        if severity in {Severity.HIGH, Severity.CRITICAL}:
            return (
                Severity.HIGH,
                "Elevated rainfall-based soil risk proxy",
                "Inspect ground conditions.",
            )
        if severity == Severity.MODERATE:
            return (
                Severity.MODERATE,
                "Rainfall-based soil risk proxy",
                "Check footing and access routes.",
            )
    if observation.metric_name == "crew_wildlife_sighting":
        return Severity.MODERATE, "Recent crew wildlife sighting", "Use site wildlife procedures."
    return None


async def evaluate_observation(
    session: AsyncSession,
    observation: HazardObservation,
    settings: Settings | None = None,
) -> Alert | None:
    settings = settings or get_settings()
    match = _rule_for(observation, settings)
    if match is None:
        return None
    severity, title, action = match
    source_ref = f"observation:{observation.id}"
    existing = await session.scalar(select(Alert).where(Alert.source_reference == source_ref))
    if existing:
        return existing
    alert = Alert(
        site_id=observation.site_id,
        hazard_type=observation.hazard_type,
        severity=severity,
        status=AlertStatus.ACTIVE,
        title=title,
        message=f"Triggered by {observation.source} {observation.metric_name}.",
        recommended_action=action,
        triggered_at=observation.observed_at,
        expires_at=observation.valid_until,
        source_reference=source_ref,
        details={
            "threshold_profile": settings.alert_threshold_profile,
            "observation_quality": observation.quality_status.value,
            "source_metadata": observation.metadata_,
        },
    )
    session.add(alert)
    await session.flush()
    session.add(
        AlertTransition(
            alert_id=alert.id,
            from_status=None,
            to_status=AlertStatus.ACTIVE,
            reason=title,
            source_reference=source_ref,
        )
    )
    publish_event(
        session,
        "alert.created",
        {"alert_id": str(alert.id), "site_id": str(alert.site_id), "severity": severity.value},
        alert.site_id,
    )
    return alert
