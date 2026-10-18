from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from app.core.config import Settings
from app.models.entities import HazardObservation, Severity

ObservationSeverity = Literal["LOW", "MODERATE", "HIGH", "CRITICAL", "UNKNOWN"]


@dataclass(frozen=True)
class SeverityAssessment:
    severity: ObservationSeverity
    basis: str


def _threshold_severity(
    value: float, moderate: float, high: float, critical: float
) -> ObservationSeverity:
    if value >= critical:
        return "CRITICAL"
    if value >= high:
        return "HIGH"
    if value >= moderate:
        return "MODERATE"
    return "LOW"


def _temperature_f(value: float, unit: str | None) -> float | None:
    normalized = (unit or "").lower().replace("°", "deg")
    if normalized in {"f", "degf", "fahrenheit"}:
        return value
    if normalized in {"c", "degc", "celsius"}:
        return value * 9 / 5 + 32
    return None


def _rainfall_mm(value: float, unit: str | None) -> float | None:
    normalized = (unit or "").lower().replace(" ", "_")
    if normalized in {"mm", "mm_24h", "millimeter", "millimeters"}:
        return value
    if normalized in {"in", "inch", "inches", "in_24h"}:
        return value * 25.4
    return None


def assess_observation(observation: HazardObservation, settings: Settings) -> SeverityAssessment:
    """Classify only metrics with enough context; unknown is never treated as low.

    These configurable bands describe measurement severity. They are not official
    safety regulations and, for rainfall, do not claim that flooding is occurring.
    """
    value = observation.numeric_value
    if value is None or not math.isfinite(value):
        return SeverityAssessment("UNKNOWN", "Missing or invalid reading")

    if observation.metric_name == "calculated_heat_index":
        fahrenheit = _temperature_f(value, observation.unit)
        if fahrenheit is None:
            return SeverityAssessment("UNKNOWN", "Unrecognized heat-index unit")
        severity = _threshold_severity(
            fahrenheit,
            settings.heat_moderate_threshold_f,
            settings.heat_high_threshold_f,
            settings.heat_critical_threshold_f,
        )
        return SeverityAssessment(
            severity,
            "Configured heat-index bands "
            f"({settings.heat_moderate_threshold_f:g}/{settings.heat_high_threshold_f:g}/"
            f"{settings.heat_critical_threshold_f:g}°F)",
        )

    if observation.metric_name == "rainfall_flood_risk_proxy":
        rainfall_mm = _rainfall_mm(value, observation.unit)
        if rainfall_mm is None:
            return SeverityAssessment("UNKNOWN", "Unrecognized 24-hour rainfall unit")
        severity = _threshold_severity(
            rainfall_mm,
            settings.flood_rainfall_moderate_mm_24h,
            settings.flood_rainfall_high_mm_24h,
            settings.flood_rainfall_critical_mm_24h,
        )
        return SeverityAssessment(
            severity,
            "Configured 24-hour rainfall indicator; rainfall alone does not determine flood risk",
        )

    if observation.metric_name == "soil_saturation_risk_proxy":
        rainfall_mm = _rainfall_mm(
            value, "mm" if observation.unit == "mm_72h_rainfall" else observation.unit
        )
        if rainfall_mm is None:
            return SeverityAssessment("UNKNOWN", "Unrecognized antecedent-rainfall unit")
        severity = _threshold_severity(
            rainfall_mm,
            settings.soil_moderate_rainfall_mm_72h,
            settings.soil_high_rainfall_mm_72h,
            settings.soil_high_rainfall_mm_72h * 1.5,
        )
        return SeverityAssessment(
            severity,
            "Configured 72-hour antecedent-rainfall proxy; not measured soil saturation",
        )

    if observation.metric_name == "official_alert":
        provider_severity = str((observation.metadata_ or {}).get("severity", "")).lower()
        severity = {
            "extreme": "CRITICAL",
            "severe": "HIGH",
            "moderate": "MODERATE",
            "minor": "LOW",
        }.get(provider_severity, "UNKNOWN")
        return SeverityAssessment(severity, "Official provider alert severity")

    # Gage height and streamflow require station-specific flood stages. A raw
    # value cannot safely be placed on a generic low-to-critical scale.
    return SeverityAssessment("UNKNOWN", "No configured severity rule for this metric")


def alert_severity(assessment: SeverityAssessment) -> Severity | None:
    if assessment.severity == "UNKNOWN":
        return None
    return Severity(assessment.severity)
