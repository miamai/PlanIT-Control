from datetime import date

import pytest

import briefing
import score


def test_hazard_index_and_recommendation_thresholds() -> None:
    assert score.combine({"a": 0.5, "b": 0.5}) == pytest.approx(7.5)
    assert score.recommendation(3.49) == "go"
    assert score.recommendation(3.5) == "caution"
    assert score.recommendation(6.5) == "no-go"


def test_alert_override_does_not_change_index() -> None:
    rec, applied = score.apply_alerts(
        "go", [{"type": "lightning", "action": "stop-work", "message": "nearby strike"}]
    )
    assert rec == "no-go"
    assert applied[0]["effect"] == "no-go"


def _risk() -> dict:
    return {
        "site_id": "EIA-1",
        "date": date(2026, 10, 18).isoformat(),
        "hazard_index": 2.0,
        "recommendation": "go",
        "sub_scores": {"heat": 1.0, "convective": 0.5, "flood": 0.2, "wildfire": 0.1, "wildlife": 0.0},
        "reasons": [],
        "model_version": "v1",
    }


def test_all_reports_are_aggregated_and_untrusted_text_is_sanitized() -> None:
    facts = briefing.build_facts(
        _risk(),
        {"name": "Test"},
        [
            {
                "hazard_type": "heat",
                "description": "  water\x00 needed\nsoon ",
                "reported_at": "2026-10-17T12:00:00Z",
                "verification_status": "verified",
            },
            {
                "hazard_type": "heat",
                "description": "latest observation",
                "reported_at": "2026-10-17T13:00:00Z",
                "verification_status": "unverified",
            },
        ],
    )
    assert facts.report_counts == {"heat": 2}
    assert facts.report_status_counts == {"verified": 1, "unverified": 1}
    assert "latest observation" in facts.text
    assert "\x00" not in facts.text


def test_wildlife_is_one_category_without_animal_names() -> None:
    risk = _risk()
    risk["sub_scores"]["wildlife"] = 2.0
    facts = briefing.build_facts(
        risk,
        {"name": "Test"},
        [{"hazard_type": "wildlife", "animal": "coyote", "reported_at": "2026-10-17"}],
    )
    assert any("for wildlife before starting" in action for action in facts.actions)
    assert "coyote" not in facts.text


def test_wildlife_scoring_aggregates_sightings_and_uses_report_category() -> None:
    models = score.HazardModels.__new__(score.HazardModels)
    models.sightings = score.pd.DataFrame(
        [
            {"site_id": "EIA-1", "month": 10, "group": "group_a", "count": 4},
            {"site_id": "EIA-1", "month": 10, "group": "group_b", "count": 6},
        ]
    )
    site = {"site_id": "EIA-1", "fema_sfha": 1.0, "tide_station": "test"}
    cold_score, cold_reasons = models.wildlife(site, date(2026, 10, 18), 40, [])
    hot_score, hot_reasons = models.wildlife(site, date(2026, 10, 18), 100, [])
    assert cold_score == pytest.approx(hot_score)
    assert cold_reasons == hot_reasons
    assert cold_reasons[0]["factor"] == "gbif_wildlife"
    assert cold_reasons[0]["value"] == 10

    models.sightings = score.pd.DataFrame(columns=["site_id", "month", "group", "count"])
    without_report, _ = models.wildlife(site, date(2026, 10, 18), 75, [])
    with_wildlife, reasons = models.wildlife(
        site,
        date(2026, 10, 18),
        75,
        [{"hazard_type": "wildlife", "reported_at": "2026-10-18T00:00:00"}],
    )
    with_non_wildlife, _ = models.wildlife(
        site,
        date(2026, 10, 18),
        75,
        [{"hazard_type": "heat", "animal": "bear", "reported_at": "2026-10-18T00:00:00"}],
    )
    assert without_report == with_non_wildlife == 0
    assert with_wildlife == pytest.approx(5.0)
    assert reasons[0]["text"] == "Crew reported wildlife within the last day"


def test_template_fallback_is_checked(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*args, **kwargs):
        raise RuntimeError("offline")

    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    monkeypatch.setattr(briefing, "gemini_generate", fail)
    result = briefing.write_briefing(_risk(), {"name": "Test"}, backend="gemini")
    assert result["source"] == "template"
    facts = briefing.build_facts(_risk(), {"name": "Test"})
    assert briefing.check_briefing(result["briefing"], facts) == []


def test_number_words_quoted_from_the_facts_pass_the_check() -> None:
    risk = _risk() | {"reasons": [{"hazard": "flood", "impact": 1.0, "text": "5.85 in of rain over two weeks"}]}
    facts = briefing.build_facts(risk, {"name": "Test"})
    result = briefing.write_briefing(risk, {"name": "Test"}, backend="template")
    assert "over two weeks" in result["briefing"]
    assert briefing.check_briefing(result["briefing"], facts) == []
    # A number word the facts do not contain is still caught.
    assert briefing.check_briefing(result["briefing"] + " Expect three storms.", facts) == [
        "number 'three' (3) is not in the facts"
    ]


def test_template_that_trips_the_checker_still_returns_a_briefing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(briefing, "check_briefing", lambda draft, f: ["checker gap"])
    result = briefing.write_briefing(_risk(), {"name": "Test"}, backend="template")
    assert result["source"] == "template" and result["briefing"]
    assert result["tried"] == [{"backend": "template", "problems": ["checker gap"]}]
