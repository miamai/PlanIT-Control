from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Principal, UserPrincipal
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.models.entities import CaptureFrame, CaptureSession, CrewReport, HazardType, Site
from app.schemas.domain import (
    CaptureFeedback,
    CaptureFrameCreate,
    CaptureFrameResult,
    CaptureHazardChoice,
    CaptureSessionRead,
    CaptureSkip,
    CaptureStart,
    CaptureSubmit,
    CrewReportRead,
    Envelope,
)
from app.services.capture import (
    IDENTIFY,
    MAX_FRAME_CHECKS,
    MAX_SESSIONS_PER_MINUTE,
    BadImage,
    checklist_started,
    decode_image,
    draft,
    next_step,
    report_metadata,
    session_read,
)
from app.services.ml import MLCaptureChecklists, MLClient, MLObservation
from app.services.reports import MAX_SITE_DISTANCE_MILES, ReportRejected, store_crew_report
from app.utils.geo import haversine_miles

router = APIRouter(prefix="/api/captures", tags=["captures"])
DbSession = Annotated[AsyncSession, Depends(get_session)]
UNAVAILABLE = "Photo checks are unavailable right now. Use the standard report form."


def get_ml_client(settings: Settings = Depends(get_settings)) -> MLClient:
    if not settings.ml_enabled:
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    return MLClient(settings)


ML = Annotated[MLClient, Depends(get_ml_client)]


async def _checklists(ml: MLClient) -> MLCaptureChecklists:
    try:
        return await ml.capture_checklists()
    except (httpx.HTTPError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc


async def _owned(
    session: AsyncSession, capture_id: uuid.UUID, principal: Principal, *, admin_can_read=False
) -> CaptureSession:
    cs = await session.get(CaptureSession, capture_id)
    allowed = cs and (
        cs.reporter_subject == principal.subject or (admin_can_read and principal.role == "admin")
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="Capture not found")
    return cs


def _hazard_type(value: str | None) -> HazardType | None:
    try:
        return HazardType(value) if value else None
    except ValueError:
        return None


def _hazard(cs: CaptureSession) -> HazardType | None:
    """The confirmed hazard, or after a safety stop before one was confirmed, the stop's hazard."""
    return cs.hazard_type or _hazard_type((cs.danger or {}).get("hazard"))


async def _frame_ids(session: AsyncSession, cs: CaptureSession) -> dict[str, list[str]]:
    rows = (
        await session.execute(
            select(CaptureFrame.item, CaptureFrame.id)
            .where(CaptureFrame.session_id == cs.id)
            .order_by(CaptureFrame.captured_at)
        )
    ).all()
    out: dict[str, list[str]] = {}
    for item, frame_id in rows:
        out.setdefault(item, []).append(str(frame_id))
    return out


async def _file_report(
    session: AsyncSession,
    settings: Settings,
    cs: CaptureSession,
    hazard: HazardType,
    description: str,
) -> None:
    site = await session.get(Site, cs.site_id)
    report = await store_crew_report(
        session,
        settings,
        site,
        reporter_subject=cs.reporter_subject,
        hazard_type=hazard,
        description=description,
        latitude=cs.latitude,
        longitude=cs.longitude,
        image_reference=f"/api/captures/{cs.id}",
        image_metadata=report_metadata(cs, await _frame_ids(session, cs)),
    )
    cs.report_id = report.id
    cs.status = "submitted" if not cs.danger else "stopped"


@router.post("", status_code=201, response_model=Envelope[CaptureSessionRead])
async def start_capture(
    body: CaptureStart, principal: UserPrincipal, session: DbSession, ml: ML
) -> Envelope[CaptureSessionRead]:
    site = await session.get(Site, body.site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    distance = haversine_miles(site.latitude, site.longitude, body.latitude, body.longitude)
    if distance > MAX_SITE_DISTANCE_MILES:
        raise HTTPException(
            status_code=422, detail="Report coordinates are implausibly far from the selected site"
        )
    recent = await session.scalar(
        select(func.count())
        .select_from(CaptureSession)
        .where(
            CaptureSession.reporter_subject == principal.subject,
            CaptureSession.created_at >= datetime.now(UTC) - timedelta(minutes=1),
        )
    )
    if (recent or 0) >= MAX_SESSIONS_PER_MINUTE:
        raise HTTPException(
            status_code=429, detail="Too many photo reports started. Wait a minute."
        )
    lists = await _checklists(ml)
    cs = CaptureSession(
        site_id=site.id,
        reporter_subject=principal.subject,
        status="active",
        steps={},
        frame_checks=0,
        latitude=body.latitude,
        longitude=body.longitude,
    )
    session.add(cs)
    await session.commit()
    return Envelope(data=session_read(cs, lists))


@router.post("/{capture_id}/frames", response_model=Envelope[CaptureFrameResult])
async def check_frame(
    capture_id: uuid.UUID,
    body: CaptureFrameCreate,
    principal: UserPrincipal,
    session: DbSession,
    ml: ML,
    settings: Settings = Depends(get_settings),
) -> Envelope[CaptureFrameResult]:
    cs = await _owned(session, capture_id, principal)
    lists = await _checklists(ml)
    expected = next_step(cs, lists)
    if not expected or expected.id != body.item:
        raise HTTPException(status_code=409, detail="That step isn't the next one in this report")
    if len(body.images) != expected.frames:
        raise HTTPException(status_code=422, detail=f"This step takes {expected.frames} photo(s)")
    if cs.frame_checks >= MAX_FRAME_CHECKS:
        raise HTTPException(
            status_code=429, detail="This report has used all its photo checks. Send it as it is."
        )
    try:
        images = [decode_image(image) for image in body.images]
    except BadImage as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    cs.frame_checks += 1
    await session.commit()  # count the check even if the ML call fails
    try:
        obs: MLObservation = await ml.observe(
            cs.hazard_type.value if cs.hazard_type else None,
            body.item,
            [payload for payload, _, _ in images],
            body.heading_deg,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 422:
            raise HTTPException(status_code=422, detail="That photo couldn't be checked") from exc
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc
    except (httpx.HTTPError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc

    cs.latitude, cs.longitude = body.latitude, body.longitude
    keep = obs.satisfied or obs.danger is not None
    if keep:
        # A step done again replaces its earlier photos; retakes that fail are never stored.
        await session.execute(
            delete(CaptureFrame).where(
                CaptureFrame.session_id == cs.id, CaptureFrame.item == body.item
            )
        )
        now = datetime.now(UTC)
        for _, raw, content_type in images:
            session.add(
                CaptureFrame(
                    session_id=cs.id,
                    item=body.item,
                    image=raw,
                    content_type=content_type,
                    latitude=body.latitude,
                    longitude=body.longitude,
                    heading_deg=body.heading_deg,
                    captured_at=now,
                )
            )
    if obs.satisfied:
        step = {"status": "done", "text": obs.text, "observation": obs.observation}
        if body.item == IDENTIFY:
            step |= {"hazard_guess": obs.hazard_guess, "confidence": obs.confidence}
        cs.steps = {**cs.steps, body.item: step}
    await session.flush()

    if obs.danger:
        cs.danger = obs.danger.model_dump()
        cs.status = "stopped"
        hazard = _hazard(cs)
        if hazard:
            # The crew is told to leave, and their report goes out now with what was captured.
            # A rejection (rate limit, distance) happens before any write, and the crew can
            # still send it from the stop screen.
            try:
                await _file_report(session, settings, cs, hazard, draft(cs, lists))
            except ReportRejected:
                pass
    await session.commit()

    feedback = CaptureFeedback(
        item=body.item,
        satisfied=obs.satisfied,
        text=obs.text,
        hint=obs.hint_text,
        hazard_guess=_hazard_type(obs.hazard_guess),
        confidence=obs.confidence,
    )
    return Envelope(data=CaptureFrameResult(session=session_read(cs, lists), feedback=feedback))


@router.post("/{capture_id}/hazard", response_model=Envelope[CaptureSessionRead])
async def choose_hazard(
    capture_id: uuid.UUID,
    body: CaptureHazardChoice,
    principal: UserPrincipal,
    session: DbSession,
    ml: ML,
) -> Envelope[CaptureSessionRead]:
    cs = await _owned(session, capture_id, principal)
    if cs.status != "active" or checklist_started(cs):
        raise HTTPException(status_code=409, detail="The hazard can't change once steps are done")
    lists = await _checklists(ml)
    cs.hazard_type = body.hazard_type
    await session.commit()
    return Envelope(data=session_read(cs, lists))


@router.post("/{capture_id}/skip", response_model=Envelope[CaptureSessionRead])
async def skip_step(
    capture_id: uuid.UUID,
    body: CaptureSkip,
    principal: UserPrincipal,
    session: DbSession,
    ml: ML,
) -> Envelope[CaptureSessionRead]:
    cs = await _owned(session, capture_id, principal)
    lists = await _checklists(ml)
    expected = next_step(cs, lists)
    if not expected or expected.id != body.item or body.item == IDENTIFY:
        raise HTTPException(status_code=409, detail="That step can't be skipped now")
    cs.steps = {**cs.steps, body.item: {"status": "skipped"}}
    await session.commit()
    return Envelope(data=session_read(cs, lists))


@router.post("/{capture_id}/submit", status_code=201, response_model=Envelope[CrewReportRead])
async def submit_capture(
    capture_id: uuid.UUID,
    body: CaptureSubmit,
    principal: UserPrincipal,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> Envelope[CrewReportRead]:
    cs = await _owned(session, capture_id, principal)
    if cs.report_id or cs.status == "submitted":
        raise HTTPException(status_code=409, detail="This report was already sent")
    hazard = _hazard(cs)
    if hazard is None:
        raise HTTPException(status_code=409, detail="Confirm the hazard before sending")
    try:
        await _file_report(session, settings, cs, hazard, body.description)
    except ReportRejected as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    await session.commit()
    report = await session.get(CrewReport, cs.report_id)
    return Envelope(data=CrewReportRead.model_validate(report))


@router.get(
    "/{capture_id}/frames/{frame_id}",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}}}},
)
async def frame_image(
    capture_id: uuid.UUID, frame_id: uuid.UUID, principal: UserPrincipal, session: DbSession
) -> Response:
    cs = await _owned(session, capture_id, principal, admin_can_read=True)
    frame = await session.get(CaptureFrame, frame_id)
    if not frame or frame.session_id != cs.id:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(
        content=frame.image,
        media_type=frame.content_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )
