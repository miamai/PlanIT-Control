from datetime import UTC, date, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.core.config import Settings
from app.models.entities import HazardObservation, HazardType, QualityStatus, Severity
from app.schemas.domain import RiskRead
from app.services.decision import assess_decision
from app.services.hazard_severity import assess_observation


def _observation(metric: str, value: float | None, unit: str, hazard: HazardType):
    return HazardObservation(
        site_id=uuid4(),
        hazard_type=hazard,
        source="test",
        source_event_id=str(uuid4()),
        observed_at=datetime(2026, 10, 17, tzinfo=UTC),
        metric_name=metric,
        numeric_value=value,
        unit=unit,
        metadata_={},
        quality_status=QualityStatus.VERIFIED,
        is_estimated=False,
    )


def test_heat_and_rainfall_indicator_severity_are_monotonic() -> None:
    settings = Settings(_env_file=None)
    heat = [
        assess_observation(
            _observation("calculated_heat_index", value, "degF", HazardType.HEAT), settings
        ).severity
        for value in (80, 96, 111, 130)
    ]
    rainfall = [
        assess_observation(
            _observation("rainfall_flood_risk_proxy", value, "mm_24h", HazardType.FLOOD),
            settings,
        ).severity
        for value in (10, 45, 70, 120)
    ]
    assert heat == ["LOW", "MODERATE", "HIGH", "CRITICAL"]
    assert rainfall == ["LOW", "MODERATE", "HIGH", "CRITICAL"]


def test_missing_or_context_dependent_readings_are_unknown() -> None:
    settings = Settings(_env_file=None)
    missing = _observation("calculated_heat_index", None, "degF", HazardType.HEAT)
    gage = _observation("gage_height", 3.21, "ft", HazardType.FLOOD)
    assert assess_observation(missing, settings).severity == "UNKNOWN"
    assessment = assess_observation(gage, settings)
    assert assessment.severity == "UNKNOWN"
    assert "No configured severity rule" in assessment.basis


def test_decision_policy_handles_alert_overrides_and_unavailable_scores() -> None:
    stop_alert = SimpleNamespace(
        action_code="STOP_WORK",
        severity=Severity.CRITICAL,
        hazard_type=HazardType.LIGHTNING,
        title="Lightning stop-work condition",
    )
    assert assess_decision(1.0, "available", [stop_alert]).decision == "NO_GO"
    assert assess_decision(None, "missing", []).decision == "REVIEW_REQUIRED"
    assert assess_decision(2.0, "stale", []).decision == "REVIEW_REQUIRED"
    assert assess_decision(2.0, "available", []).decision == "GO"
    assert assess_decision(5.0, "available", []).decision == "CAUTION"
    assert assess_decision(7.5, "available", []).decision == "NO_GO"


def test_top_drivers_only_expose_valid_known_explanations() -> None:
    score = SimpleNamespace(
        id=uuid4(),
        site_id=uuid4(),
        score=7.2,
        generated_at=datetime(2026, 10, 17, 23, tzinfo=UTC),
        prediction_date=date(2026, 10, 18),
        valid_for_seconds=86400,
        model_version="v1",
        score_source="ml_service",
        contributing_factors={
            "sub_scores": {"heat": 8.0, "wildlife": 3.0},
            "reasons": [
                {"hazard": "heat", "impact": 2.5, "text": "Heat index peaks at 111°F"},
                {
                    "hazard": "wildlife",
                    "impact": 1.0,
                    "text": "Recent crew wildlife report",
                },
                {"hazard": "flood", "impact": 0, "text": "Not a positive contribution"},
            ],
        },
    )
    drivers = RiskRead.from_score(score).top_drivers
    assert [(driver.hazard, driver.severity) for driver in drivers] == [
        ("heat", "CRITICAL"),
        ("wildlife", "MODERATE"),
    ]
    assert [driver.explanation_method for driver in drivers] == ["tree_shap", "rule_based"]

    score.score_source = "model"
    assert RiskRead.from_score(score).top_drivers == []
