from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AdminPrincipal, UserPrincipal
from app.core.config import Settings, get_settings
from app.core.database import SessionFactory, database_health, get_session
from app.models.entities import (
    Alert,
    AlertStatus,
    CrewReport,
    EventOutbox,
    HazardObservation,
    HazardType,
    RiskScore,
    SafetyBriefing,
    Site,
)
from app.schemas.domain import (
    AlertRead,
    BriefingRead,
    CrewReportCreate,
    CrewReportRead,
    Envelope,
    ObservationRead,
    PageMeta,
    RiskPredictionCreate,
    RiskRanking,
    RiskRead,
    RiskResult,
    SiteRead,
)
from app.services.decision import assess_decision
from app.services.events import publish_event
from app.services.hazard_severity import assess_observation
from app.services.reports import ReportRejected, store_crew_report
from app.services.risk import historical_features

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_session)]
OPEN_ALERT_STATUSES = (
    AlertStatus.ACTIVE,
    AlertStatus.ACKNOWLEDGED,
    AlertStatus.ALL_CLEAR_ELIGIBLE,
)


def _observation_read(observation: HazardObservation, settings: Settings) -> ObservationRead:
    assessment = assess_observation(observation, settings)
    return ObservationRead.model_validate(observation).model_copy(
        update={"severity": assessment.severity, "severity_basis": assessment.basis}
    )


@router.get("/health", tags=["system"])
async def health() -> dict:
    healthy = await database_health()
    payload = {"status": "ok" if healthy else "degraded", "database": healthy}
    if not healthy:
        return JSONResponse(status_code=503, content=payload)
    return payload


@router.get("/api/sites", response_model=Envelope[list[SiteRead]], tags=["sites"])
async def list_sites(
    _: UserPrincipal,
    session: DbSession,
    state: str | None = None,
    county: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Envelope[list[SiteRead]]:
    filters = []
    if state:
        filters.append(Site.state == state.upper())
    if county:
        filters.append(func.lower(Site.county) == county.lower())
    total = await session.scalar(select(func.count()).select_from(Site).where(*filters))
    sites = (
        await session.scalars(
            select(Site).where(*filters).order_by(Site.name).limit(limit).offset(offset)
        )
    ).all()
    return Envelope(
        data=[SiteRead.model_validate(site) for site in sites],
        meta=PageMeta(limit=limit, offset=offset, total=total or 0),
    )


@router.get("/api/sites/{site_id}", response_model=Envelope[SiteRead], tags=["sites"])
async def get_site(site_id: uuid.UUID, _: UserPrincipal, session: DbSession) -> Envelope[SiteRead]:
    site = await session.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return Envelope(data=SiteRead.model_validate(site))


@router.get(
    "/api/sites/{site_id}/hazards",
    response_model=Envelope[list[ObservationRead]],
    tags=["hazards"],
)
async def site_hazards(
    site_id: uuid.UUID,
    _: UserPrincipal,
    session: DbSession,
    hazard_type: HazardType | None = None,
    since: datetime | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    settings: Settings = Depends(get_settings),
) -> Envelope[list[ObservationRead]]:
    filters = [HazardObservation.site_id == site_id]
    if hazard_type:
        filters.append(HazardObservation.hazard_type == hazard_type)
    if since:
        filters.append(HazardObservation.observed_at >= since)
    total = await session.scalar(
        select(func.count()).select_from(HazardObservation).where(*filters)
    )
    rows = (
        await session.scalars(
            select(HazardObservation)
            .where(*filters)
            .order_by(HazardObservation.observed_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Envelope(
        data=[_observation_read(row, settings) for row in rows],
        meta=PageMeta(limit=limit, offset=offset, total=total or 0),
    )


async def _alerts_query(
    session: AsyncSession,
    site_id: uuid.UUID | None,
    hazard_type: HazardType | None,
    severity: str | None,
    alert_status: AlertStatus | None,
    limit: int,
    offset: int,
) -> Envelope[list[AlertRead]]:
    filters = []
    if site_id:
        filters.append(Alert.site_id == site_id)
    if hazard_type:
        filters.append(Alert.hazard_type == hazard_type)
    if severity:
        filters.append(Alert.severity == severity.upper())
    if alert_status:
        filters.append(Alert.status == alert_status)
    total = await session.scalar(select(func.count()).select_from(Alert).where(*filters))
    alerts = (
        await session.scalars(
            select(Alert)
            .where(*filters)
            .order_by(Alert.triggered_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Envelope(
        data=[AlertRead.model_validate(alert) for alert in alerts],
        meta=PageMeta(limit=limit, offset=offset, total=total or 0),
    )


@router.get("/api/alerts", response_model=Envelope[list[AlertRead]], tags=["alerts"])
async def all_alerts(
    _: UserPrincipal,
    session: DbSession,
    site_id: uuid.UUID | None = None,
    hazard_type: HazardType | None = None,
    severity: str | None = None,
    status_: AlertStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Envelope[list[AlertRead]]:
    return await _alerts_query(session, site_id, hazard_type, severity, status_, limit, offset)


@router.post(
    "/api/reports", status_code=201, response_model=Envelope[CrewReportRead], tags=["reports"]
)
async def create_report(
    body: CrewReportCreate,
    principal: UserPrincipal,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> Envelope[CrewReportRead]:
    site = await session.get(Site, body.site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    try:
        report = await store_crew_report(
            session,
            settings,
            site,
            reporter_subject=principal.subject,
            hazard_type=body.hazard_type,
            description=body.description,
            latitude=body.latitude,
            longitude=body.longitude,
            reported_at=body.observed_at,
            image_reference=body.image_reference,
            image_metadata=body.image_metadata,
        )
    except ReportRejected as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    await session.commit()
    await session.refresh(report)
    return Envelope(data=CrewReportRead.model_validate(report))


@router.get("/api/reports", response_model=Envelope[list[CrewReportRead]], tags=["reports"])
async def list_reports(
    _: AdminPrincipal,
    session: DbSession,
    site_id: uuid.UUID | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Envelope[list[CrewReportRead]]:
    filters = [CrewReport.site_id == site_id] if site_id else []
    total = await session.scalar(select(func.count()).select_from(CrewReport).where(*filters))
    reports = (
        await session.scalars(
            select(CrewReport)
            .where(*filters)
            .order_by(CrewReport.reported_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Envelope(
        data=[CrewReportRead.model_validate(row) for row in reports],
        meta=PageMeta(limit=limit, offset=offset, total=total or 0),
    )


async def _latest_risk(session: AsyncSession, site_id: uuid.UUID) -> RiskScore | None:
    return await session.scalar(
        select(RiskScore)
        .where(RiskScore.site_id == site_id)
        .order_by(RiskScore.generated_at.desc())
        .limit(1)
    )


async def _active_alerts(session: AsyncSession, site_id: uuid.UUID) -> list[Alert]:
    return list(
        (
            await session.scalars(
                select(Alert).where(
                    Alert.site_id == site_id,
                    Alert.status.in_(OPEN_ALERT_STATUSES),
                )
            )
        ).all()
    )


@router.get("/api/sites/{site_id}/risk", response_model=Envelope[RiskResult], tags=["risk"])
async def site_risk(
    site_id: uuid.UUID, _: UserPrincipal, session: DbSession
) -> Envelope[RiskResult]:
    site = await session.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    score = await _latest_risk(session, site_id)
    status = _risk_status(site, score)
    decision = assess_decision(
        score.score if score else None, status, await _active_alerts(session, site_id)
    )
    return Envelope(
        data=RiskResult(
            site_id=site_id,
            status=status,
            score=RiskRead.from_score(score) if score else None,
            decision=decision.decision,
            decision_basis=decision.basis,
        )
    )


@router.get(
    "/api/sites/{site_id}/risk/history", response_model=Envelope[list[RiskRead]], tags=["risk"]
)
async def site_risk_history(
    site_id: uuid.UUID,
    _: UserPrincipal,
    session: DbSession,
    days: int = Query(14, ge=1, le=90),
) -> Envelope[list[RiskRead]]:
    site = await session.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    today = datetime.now(UTC).astimezone(ZoneInfo(site.timezone)).date()
    cutoff = today - timedelta(days=days - 1)
    rows = (
        await session.scalars(
            select(RiskScore)
            .where(
                RiskScore.site_id == site_id,
                RiskScore.prediction_date >= cutoff,
                RiskScore.prediction_date <= today,
            )
            .order_by(RiskScore.prediction_date, RiskScore.generated_at.desc())
        )
    ).all()
    latest_per_day: dict = {}
    for row in rows:
        latest_per_day.setdefault(row.prediction_date, row)
    return Envelope(data=[RiskRead.from_score(row) for row in latest_per_day.values()])


@router.get("/api/risk/rankings", response_model=Envelope[list[RiskRanking]], tags=["risk"])
async def risk_rankings(_: UserPrincipal, session: DbSession) -> Envelope[list[RiskRanking]]:
    sites = (await session.scalars(select(Site))).all()
    # One query for every site's latest score instead of one query per site.
    newest_first = (
        func.row_number()
        .over(partition_by=RiskScore.site_id, order_by=RiskScore.generated_at.desc())
        .label("rank")
    )
    ranked = (
        select(RiskScore.id, newest_first)
        .subquery()
    )
    latest_scores = (
        await session.scalars(
            select(RiskScore).join(ranked, RiskScore.id == ranked.c.id).where(ranked.c.rank == 1)
        )
    ).all()
    latest = {score.site_id: score for score in latest_scores}
    active_alerts = (
        await session.scalars(select(Alert).where(Alert.status.in_(OPEN_ALERT_STATUSES)))
    ).all()
    alerts_by_site: dict[uuid.UUID, list[Alert]] = {}
    for alert in active_alerts:
        alerts_by_site.setdefault(alert.site_id, []).append(alert)
    rankings = []
    for site in sites:
        score = latest.get(site.id)
        status = _risk_status(site, score)
        decision = assess_decision(
            score.score if score else None, status, alerts_by_site.get(site.id, [])
        )
        rankings.append(
            RiskRanking(
                site=SiteRead.model_validate(site),
                risk=RiskRead.from_score(score) if score else None,
                status=status,
                decision=decision.decision,
                decision_basis=decision.basis,
            )
        )
    rankings.sort(key=lambda row: row.risk.score if row.risk else -1, reverse=True)
    return Envelope(data=rankings)


@router.get("/api/risk/features", tags=["risk"])
async def risk_features(
    site_id: uuid.UUID,
    start: datetime,
    end: datetime,
    _: AdminPrincipal,
    session: DbSession,
) -> dict:
    if start >= end:
        raise HTTPException(status_code=422, detail="start must be before end")
    return {"data": await historical_features(session, site_id, start, end)}


@router.post(
    "/api/risk/predictions",
    status_code=201,
    response_model=Envelope[RiskRead],
    tags=["risk"],
)
async def store_risk_prediction(
    body: RiskPredictionCreate, _: AdminPrincipal, session: DbSession
) -> Envelope[RiskRead]:
    if not await session.get(Site, body.site_id):
        raise HTTPException(status_code=404, detail="Site not found")
    existing = await session.scalar(
        select(RiskScore).where(
            RiskScore.site_id == body.site_id,
            RiskScore.prediction_date == body.prediction_date,
            RiskScore.model_version == body.model_version,
        )
    )
    if existing:
        return Envelope(data=RiskRead.from_score(existing))
    score = RiskScore(**body.model_dump(), score_source="model")
    session.add(score)
    await session.flush()
    publish_event(
        session,
        "risk.updated",
        {"site_id": str(body.site_id), "score_id": str(score.id), "score": score.score},
        body.site_id,
    )
    await session.commit()
    await session.refresh(score)
    return Envelope(data=RiskRead.from_score(score))


def _risk_status(site: Site, score: RiskScore | None) -> str:
    if score:
        now = datetime.now(UTC)
        generated = score.generated_at
        if generated.tzinfo is None:  # SQLite drops the zone; every stored time is UTC
            generated = generated.replace(tzinfo=UTC)
        expires = generated + timedelta(seconds=score.valid_for_seconds)
        local_today = now.astimezone(ZoneInfo(site.timezone)).date()
        return "available" if expires > now and score.prediction_date >= local_today else "stale"
    return "unsupported" if not site.ml_supported else "missing"


@router.get("/api/briefings", response_model=Envelope[list[BriefingRead]], tags=["briefings"])
async def fleet_briefings(
    _: UserPrincipal,
    session: DbSession,
    briefing_date: date | None = None,
    since: date | None = None,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> Envelope[list[BriefingRead]]:
    filters = []
    if briefing_date:
        filters.append(SafetyBriefing.briefing_date == briefing_date)
    if since:
        filters.append(SafetyBriefing.briefing_date >= since)
    total = await session.scalar(select(func.count()).select_from(SafetyBriefing).where(*filters))
    rows = (
        await session.scalars(
            select(SafetyBriefing)
            .where(*filters)
            .order_by(SafetyBriefing.briefing_date.desc(), SafetyBriefing.generated_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Envelope(
        data=[BriefingRead.model_validate(row) for row in rows],
        meta=PageMeta(limit=limit, offset=offset, total=total or 0),
    )


@router.get("/api/stream", tags=["events"])
async def stream_events(
    _: UserPrincipal,
    request: Request,
    session: DbSession,
    last_event_id: Annotated[int | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    # The request session (shared with the auth lookup) would otherwise stay idle
    # in a transaction for the life of the stream, holding a pooled connection and
    # a lock on user_accounts that blocks migrations. Each poll opens its own.
    await session.close()

    async def events():
        cursor = last_event_id or 0
        while not await request.is_disconnected():
            async with SessionFactory() as session:
                rows = (
                    await session.scalars(
                        select(EventOutbox)
                        .where(EventOutbox.id > cursor)
                        .order_by(EventOutbox.id)
                        .limit(100)
                    )
                ).all()
            if rows:
                for row in rows:
                    cursor = row.id
                    yield f"id: {row.id}\nevent: {row.event_type}\ndata: {json.dumps(row.payload, default=str)}\n\n"
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(10)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
