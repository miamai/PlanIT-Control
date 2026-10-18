import base64
import json
import logging

import pytest
import requests
from fastapi.testclient import TestClient

import api
import capture

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 64).decode()


def fake(*replies: dict | str):
    """A vision backend that returns the given replies in order and records the prompts it saw."""
    queue = [r if isinstance(r, str) else json.dumps(r) for r in replies]
    seen: list[str] = []

    def generate(system: str, prompt: str, images: list[str]) -> str:
        seen.append(prompt)
        return queue.pop(0)

    generate.seen = seen  # type: ignore[attr-defined]
    return generate


def test_checklists_list_identify_and_flood_steps_in_order() -> None:
    lists = capture.checklists()
    assert lists["identify"]["id"] == "identify"
    assert [s["id"] for s in lists["hazards"]["flood"]] == ["extent", "depth", "flow", "source"]
    assert lists["hazards"]["flood"][2]["frames"] == 2


def test_no_instruction_asks_the_crew_to_approach() -> None:
    copy = [capture.IDENTIFY.instruction, *capture.HINT_TEXT.values(),
            *(text for _, text, _ in capture.DANGERS.values()),
            *(i.instruction for items in capture.CHECKLISTS.values() for i in items)]
    for text in copy:
        assert not any(word in text.lower() for word in ("closer", "approach", "walk into", "wade")), text


def test_identify_returns_the_hazard_guess() -> None:
    result = capture.observe(None, "identify", [JPEG], generate=fake(
        {"satisfied": True, "hint": None, "danger": None, "hazard": "flood", "confidence": 0.9}))
    assert result["satisfied"] is True
    assert result["hazard_guess"] == "flood"
    assert result["confidence"] == 0.9
    assert result["text"] == "Looks like flooding or standing water"


def test_identify_with_no_hazard_visible_asks_for_a_retake() -> None:
    result = capture.observe(None, "identify", [JPEG], generate=fake(
        {"satisfied": True, "hazard": "none", "confidence": 0.8}))
    assert result["satisfied"] is False
    assert result["hazard_guess"] is None
    assert result["hint_text"] == capture.HINT_TEXT["not_visible"]


def test_satisfied_without_the_answering_fields_is_not_accepted() -> None:
    result = capture.observe("flood", "depth", [JPEG], generate=fake(
        {"satisfied": True, "hint": None, "depth_cm": 30, "reference": None}))
    assert result["satisfied"] is False
    assert result["text"] is None
    assert result["hint"] == "not_visible"


def test_depth_text_is_rounded_and_names_the_reference() -> None:
    result = capture.observe("flood", "depth", [JPEG], generate=fake(
        {"satisfied": True, "depth_cm": 31.7, "reference": "tire"}))
    assert result["text"] == "Water is about 30 cm deep, judged against a tire"
    assert result["observation"] == {"depth_cm": 31.7, "reference": "tire"}


@pytest.mark.parametrize(("heading", "direction", "expected"), [
    (90, "left_to_right", "south"),
    (90, "right_to_left", "north"),
    (0, "away_from_camera", "north"),
    (350, "toward_camera", "south"),
])
def test_flow_direction_uses_the_compass_heading(heading: float, direction: str, expected: str) -> None:
    result = capture.observe("flood", "flow", [JPEG, JPEG], heading_deg=heading, generate=fake(
        {"satisfied": True, "moving": True, "direction": direction}))
    assert result["text"] == f"Water is moving, flowing {expected}"
    assert result["observation"]["heading_deg"] == heading


def test_flow_without_a_heading_does_not_guess_a_direction() -> None:
    result = capture.observe("flood", "flow", [JPEG, JPEG], generate=fake(
        {"satisfied": True, "moving": True, "direction": "left_to_right"}))
    assert result["text"] == "Water is moving"


def test_invalid_reply_gets_one_retry_with_the_reason() -> None:
    gen = fake("not json", {"satisfied": True, "coverage": "full", "width_m": 6})
    result = capture.observe("flood", "extent", [JPEG], generate=gen)
    assert result["text"] == "Water covers the full width of the road, about 6 m across"
    assert "rejected: no JSON object found" in gen.seen[1]


def test_out_of_schema_values_fall_back_to_a_retake() -> None:
    gen = fake({"satisfied": True, "coverage": "most"}, {"satisfied": True, "hint": "walk_closer"})
    result = capture.observe("flood", "extent", [JPEG], generate=gen)
    assert result["satisfied"] is False
    assert result["hint"] == "retake"
    assert result["text"] is None


def test_danger_maps_to_fixed_copy_and_the_hazard_to_file_under() -> None:
    result = capture.observe(None, "identify", [JPEG], generate=fake(
        {"satisfied": True, "hazard": "flood", "confidence": 0.7, "danger": "rising_water"}))
    assert result["danger"] == {
        "code": "rising_water",
        "hazard": "flood",
        "instruction": "Move to higher ground now.",
        "summary": "water rising near the crew",
    }


def test_wrong_frame_count_and_bad_images_are_rejected() -> None:
    with pytest.raises(capture.CaptureError, match="2 image"):
        capture.observe("flood", "flow", [JPEG], generate=fake())
    with pytest.raises(capture.CaptureError, match="JPEG or PNG"):
        capture.observe("flood", "extent", [base64.b64encode(b"GIF89a").decode()], generate=fake())
    with pytest.raises(capture.CaptureError, match="No checklist item"):
        capture.observe("wildfire", "extent", [JPEG], generate=fake())


def test_api_maps_errors_to_status_codes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(api.app)
    assert client.get("/capture/checklists").status_code == 200
    bad = client.post("/capture/observe", json={"hazard": "flood", "item": "nope", "images": [JPEG]})
    assert bad.status_code == 422
    unavailable = client.post("/capture/observe", json={"item": "identify", "images": [JPEG]})
    assert unavailable.status_code == 503


def test_gemini_failure_reason_is_logged_but_not_shown(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "secret-test-key")
    response = requests.Response()
    response.status_code = 402
    response._content = json.dumps({"error": {"message": "Your prepayment credits are depleted."}}).encode()
    monkeypatch.setattr(capture.requests, "post", lambda *args, **kwargs: response)
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        reply = TestClient(api.app).post("/capture/observe", json={"item": "identify", "images": [JPEG]})
    assert reply.status_code == 503
    assert reply.json()["detail"] == "Photo checks are unavailable right now"
    assert "Gemini returned HTTP 402: Your prepayment credits are depleted." in caplog.text
    assert "secret-test-key" not in caplog.text
