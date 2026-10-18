from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.models.entities import Alert, Severity

Decision = Literal["GO", "CAUTION", "NO_GO", "REVIEW_REQUIRED"]


@dataclass(frozen=True)
class DecisionAssessment:
    decision: Decision
    basis: list[str]


def _index_decision(score: float) -> Decision:
    if score >= 6.5:
        return "NO_GO"
    if score >= 3.5:
        return "CAUTION"
    return "GO"


def assess_decision(
    score: float | None, risk_status: str, active_alerts: list[Alert]
) -> DecisionAssessment:
    """Apply the operational risk policy without granting work authorization."""
    stop_alerts = []
    caution_alerts = []
    for alert in active_alerts:
        action = (alert.action_code or "").lower().replace("_", "-")
        if action in {"stop-work", "stop", "no-go"} or alert.severity in {
            Severity.HIGH,
            Severity.CRITICAL,
        }:
            stop_alerts.append(alert)
        elif action == "caution" or alert.severity == Severity.MODERATE:
            caution_alerts.append(alert)

    if stop_alerts:
        return DecisionAssessment(
            "NO_GO",
            [f"Active {alert.hazard_type.value} alert: {alert.title}" for alert in stop_alerts],
        )
    if score is None or risk_status != "available":
        reason = {
            "stale": "Hazard Index is stale",
            "unsupported": "Site is outside the current model coverage",
            "missing": "Hazard Index has not been generated",
        }.get(risk_status, "Hazard Index is unavailable")
        if caution_alerts:
            reason += "; active caution alerts also require review"
        return DecisionAssessment("REVIEW_REQUIRED", [reason])

    decision = _index_decision(score)
    basis = [f"Hazard Index {score:.1f}/10 maps to {decision.replace('_', '-')} policy band"]
    if caution_alerts and decision == "GO":
        decision = "CAUTION"
        basis = [
            f"Active {alert.hazard_type.value} alert: {alert.title}" for alert in caution_alerts
        ]
    return DecisionAssessment(decision, basis)
