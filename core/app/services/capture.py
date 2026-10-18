"""Guided photo reports: which step comes next, and the report a finished capture turns into.

The checklists and the photo checks live in the ML service; this module only keeps track of a
session's progress. The report draft is joined from the sentences the ML service wrote from its
validated fields, so it never says more than the photos showed.
"""

from __future__ import annotations

import base64
import binascii
from typing import Any

from app.models.entities import CaptureSession, HazardType
from app.schemas.domain import (
    CaptureChecklistItemRead,
    CaptureDangerRead,
    CaptureSessionRead,
    CaptureStepRead,
)
from app.services.ml import MLCaptureChecklists, MLCaptureStep

IDENTIFY = "identify"
MAX_FRAME_CHECKS = 60  # photo checks per session; each one is a vision-model call
MAX_SESSIONS_PER_MINUTE = 10


class BadImage(ValueError):
    pass


def decode_image(image: str) -> tuple[str, bytes, str]:
    """The base64 payload (without any data-URL prefix), its bytes, and its content type."""
    payload = image.split(",", 1)[1] if image.startswith("data:") else image
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise BadImage("Image is not valid base64") from exc
    if raw.startswith(b"\xff\xd8\xff"):
        return payload, raw, "image/jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return payload, raw, "image/png"
    raise BadImage("Image must be a JPEG or PNG")


def checklist_for(lists: MLCaptureChecklists, hazard: HazardType | None) -> list[MLCaptureStep]:
    return lists.hazards.get(hazard.value, []) if hazard else []


def next_step(cs: CaptureSession, lists: MLCaptureChecklists) -> MLCaptureStep | None:
    if cs.status != "active":
        return None
    if cs.hazard_type is None:
        return lists.identify
    for step in checklist_for(lists, cs.hazard_type):
        if step.id not in cs.steps:
            return step
    return None


def checklist_started(cs: CaptureSession) -> bool:
    return any(item != IDENTIFY for item in cs.steps)


def draft(cs: CaptureSession, lists: MLCaptureChecklists) -> str:
    sentences = [
        cs.steps[step.id]["text"]
        for step in checklist_for(lists, cs.hazard_type)
        if cs.steps.get(step.id, {}).get("text")
    ]
    if cs.danger:
        sentences.insert(0, f"Safety stop during a guided photo report: {cs.danger['summary']}")
    return " ".join(f"{s}." for s in sentences)


def report_metadata(cs: CaptureSession, frame_ids: dict[str, list[str]]) -> dict[str, Any]:
    """What a capture adds to its crew report: every step's result and the photos behind it."""
    identify = cs.steps.get(IDENTIFY, {})
    return {
        "capture_session_id": str(cs.id),
        "hazard_guess": identify.get("hazard_guess"),
        "confidence": identify.get("confidence"),
        "danger": cs.danger,
        "steps": [
            {
                "item": item,
                "status": step.get("status"),
                "text": step.get("text"),
                "observation": step.get("observation", {}),
                "frame_ids": frame_ids.get(item, []),
            }
            for item, step in cs.steps.items()
        ],
    }


def session_read(cs: CaptureSession, lists: MLCaptureChecklists) -> CaptureSessionRead:
    items = checklist_for(lists, cs.hazard_type)
    upcoming = next_step(cs, lists)
    return CaptureSessionRead(
        id=cs.id,
        site_id=cs.site_id,
        hazard_type=cs.hazard_type,
        status=cs.status,
        guided=bool(items),
        next_step=(
            CaptureStepRead(
                item=upcoming.id, instruction=upcoming.instruction, frames=upcoming.frames
            )
            if upcoming
            else None
        ),
        checklist=[
            CaptureChecklistItemRead(
                item=step.id,
                instruction=step.instruction,
                frames=step.frames,
                status=cs.steps.get(step.id, {}).get("status", "pending"),
                text=cs.steps.get(step.id, {}).get("text"),
            )
            for step in items
        ],
        draft=draft(cs, lists),
        danger=CaptureDangerRead.model_validate(cs.danger) if cs.danger else None,
        report_id=cs.report_id,
    )
