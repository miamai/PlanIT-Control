from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AdminPrincipal, CrewPrincipal, SupervisorPrincipal
from app.core.config import Settings, get_settings
from app.core.database import SessionFactory, database_health, get_session
from app.models.entities import (
    Alert,
    AlertStatus,
    AlertTransition,
    CrewReport,
    EventOutbox,
    HazardObservation,
    HazardType,
    ProviderRun,
    QualityStatus,
    RiskScore,
    SafetyBriefing,
    Site,
)
from app.schemas.domain import (
    AlertRead,
    AlertUpdate,
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
from app.services.database_check import inspect_database
from app.services.eia import import_plants, parse_cached_sites
from app.services.events import publish_event
from app.services.ingestion import run_provider
from app.services.risk import historical_features
from app.services.rules import evaluate_observation
from app.utils.geo import haversine_miles

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_session)]


@router.get("/health", tags=["system"])
async def health() -> dict:
    healthy = await database_health()
    payload = {"status": "ok" if healthy else "degraded", "database": healthy}
    if not healthy:
        return JSONResponse(status_code=503, content=payload)
    return payload


@router.get("/api/admin/system", tags=["admin"])
async def system_status(
    _: AdminPrincipal,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> dict:
    return {"data": (await inspect_database(session, settings)).to_dict()}


@router.get("/api/sites", response_model=Envelope[list[SiteRead]], tags=["sites"])
async def list_sites(
    _: CrewPrincipal,
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
async def get_site(site_id: uuid.UUID, _: CrewPrincipal, session: DbSession) -> Envelope[SiteRead]:
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
    _: CrewPrincipal,
    session: DbSession,
    hazard_type: HazardType | None = None,
    since: datetime | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
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
        data=[ObservationRead.model_validate(row) for row in rows],
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


@router.get(
    "/api/sites/{site_id}/alerts", response_model=Envelope[list[AlertRead]], tags=["alerts"]
)
async def site_alerts(
    site_id: uuid.UUID,
    _: CrewPrincipal,
    session: DbSession,
    hazard_type: HazardType | None = None,
    severity: str | None = None,
    status_: AlertStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Envelope[list[AlertRead]]:
    return await _alerts_query(session, site_id, hazard_type, severity, status_, limit, offset)


@router.get("/api/alerts", response_model=Envelope[list[AlertRead]], tags=["alerts"])
async def all_alerts(
    _: CrewPrincipal,
    session: DbSession,
    site_id: uuid.UUID | None = None,
    hazard_type: HazardType | None = None,
    severity: str | None = None,
    status_: AlertStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Envelope[list[AlertRead]]:
    return await _alerts_query(session, site_id, hazard_type, severity, status_, limit, offset)


@router.patch("/api/alerts/{alert_id}", response_model=Envelope[AlertRead], tags=["alerts"])
async def update_alert(
    alert_id: uuid.UUID,
    body: AlertUpdate,
    principal: SupervisorPrincipal,
    session: DbSession,
) -> Envelope[AlertRead]:
    alert = await session.get(Alert, alert_id, with_for_update=True)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if body.status == AlertStatus.ALL_CLEAR_ELIGIBLE:
        raise HTTPException(
            status_code=422, detail="All-clear eligibility is controlled by the server rule"
        )
    previous = alert.status
    alert.status = body.status
    alert.updated_at = datetime.now(UTC)
    if body.status == AlertStatus.RESOLVED:
        alert.resolved_at = alert.updated_at
    session.add(
        AlertTransition(
            alert_id=alert.id,
            from_status=previous,
            to_status=body.status,
            reason=f"{body.reason} (by {principal.subject})",
        )
    )
    publish_event(
        session,
        "alert.updated",
        {"alert_id": str(alert.id), "status": body.status.value},
        alert.site_id,
    )
    await session.commit()
    await session.refresh(alert)
    return Envelope(data=AlertRead.model_validate(alert))


@router.post(
    "/api/reports", status_code=201, response_model=Envelope[CrewReportRead], tags=["reports"]
)
async def create_report(
    body: CrewReportCreate,
    principal: CrewPrincipal,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> Envelope[CrewReportRead]:
    site = await session.get(Site, body.site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    now = datetime.now(UTC)
    recent_count = await session.scalar(
        select(func.count())
        .select_from(CrewReport)
        .where(
            CrewReport.reporter_subject == principal.subject,
            CrewReport.reported_at >= now - timedelta(minutes=1),
        )
    )
    if (recent_count or 0) >= 30:
        raise HTTPException(status_code=429, detail="Report submission rate limit exceeded")
    if haversine_miles(site.latitude, site.longitude, body.latitude, body.longitude) > 100:
        raise HTTPException(
            status_code=422, detail="Report coordinates are implausibly far from the selected site"
        )
    report = CrewReport(
        site_id=body.site_id,
        hazard_type=body.hazard_type,
        description=body.description,
        latitude=body.latitude,
        longitude=body.longitude,
        image_reference=body.image_reference,
        image_metadata=body.image_metadata,
        reported_at=body.observed_at or now,
        reporter_subject=principal.subject,
        verification_status="unverified",
    )
    session.add(report)
    await session.flush()
    if body.hazard_type == HazardType.WILDLIFE:
        sites = (await session.scalars(select(Site))).all()
        for nearby in sites:
            distance = haversine_miles(
                nearby.latitude, nearby.longitude, body.latitude, body.longitude
            )
            if distance <= settings.wildlife_share_radius_miles:
                observation = HazardObservation(
                    site_id=nearby.id,
                    hazard_type=HazardType.WILDLIFE,
                    source="crew_report",
                    source_event_id=str(report.id),
                    observed_at=report.reported_at,
                    metric_name="crew_wildlife_sighting",
                    latitude=body.latitude,
                    longitude=body.longitude,
                    metadata_={
                        "description": body.description,
                        "distance_miles": round(distance, 3),
                        "verification_status": "unverified",
                    },
                    quality_status=QualityStatus.PROVISIONAL,
                    is_estimated=False,
                )
                session.add(observation)
                await session.flush()
                await evaluate_observation(session, observation)
    await session.commit()
    await session.refresh(report)
    return Envelope(data=CrewReportRead.model_validate(report))


@router.get("/api/reports", response_model=Envelope[list[CrewReportRead]], tags=["reports"])
async def list_reports(
    _: SupervisorPrincipal,
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


@router.get("/api/sites/{site_id}/risk", response_model=Envelope[RiskResult], tags=["risk"])
async def site_risk(
    site_id: uuid.UUID, _: CrewPrincipal, session: DbSession
) -> Envelope[RiskResult]:
    if not await session.get(Site, site_id):
        raise HTTPException(status_code=404, detail="Site not found")
    score = await _latest_risk(session, site_id)
    return Envelope(
        data=RiskResult(
            site_id=site_id,
            status="available" if score else "missing",
            score=RiskRead.model_validate(score) if score else None,
        )
    )


@router.get("/api/risk/rankings", response_model=Envelope[list[RiskRanking]], tags=["risk"])
async def risk_rankings(_: CrewPrincipal, session: DbSession) -> Envelope[list[RiskRanking]]:
    sites = (await session.scalars(select(Site))).all()
    rankings = []
    for site in sites:
        score = await _latest_risk(session, site.id)
        rankings.append(
            RiskRanking(
                site=SiteRead.model_validate(site),
                risk=RiskRead.model_validate(score) if score else None,
                status="available" if score else "missing",
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
            RiskScore.generated_at == body.generated_at,
            RiskScore.model_version == body.model_version,
        )
    )
    if existing:
        return Envelope(data=RiskRead.model_validate(existing))
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
    return Envelope(data=RiskRead.model_validate(score))


@router.get(
    "/api/sites/{site_id}/briefings",
    response_model=Envelope[list[BriefingRead]],
    tags=["briefings"],
)
async def briefings(
    site_id: uuid.UUID, _: CrewPrincipal, session: DbSession
) -> Envelope[list[BriefingRead]]:
    rows = (
        await session.scalars(
            select(SafetyBriefing)
            .where(SafetyBriefing.site_id == site_id)
            .order_by(SafetyBriefing.briefing_date.desc())
        )
    ).all()
    return Envelope(data=[BriefingRead.model_validate(row) for row in rows])


@router.post("/api/admin/ingestion/{provider}", tags=["admin"])
async def ingest_provider(
    provider: str,
    _: AdminPrincipal,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> dict:
    allowed = {"weather", "weather_alerts", "usgs", "wildfire", "soil"}
    if provider not in allowed:
        raise HTTPException(status_code=404, detail="Unknown provider")
    recent = await session.scalar(
        select(func.count())
        .select_from(ProviderRun)
        .where(
            ProviderRun.provider == provider,
            ProviderRun.started_at >= datetime.now(UTC) - timedelta(minutes=1),
        )
    )
    if recent:
        raise HTTPException(status_code=429, detail="Provider was already requested this minute")
    run = await run_provider(session, provider, settings)
    return {
        "data": {
            "run_id": str(run.id),
            "status": run.status,
            "records_written": run.records_written,
            "error": run.error,
        }
    }


@router.post("/api/admin/sites/import-eia", tags=["admin"])
async def import_cached_eia_sites(_: AdminPrincipal, session: DbSession) -> dict:
    """Refresh from the bundled, authenticated EIA-860M snapshot.

    Network refreshes remain a CLI operation so an HTTP request cannot make the
    production service download and parse an arbitrary workbook.
    """
    count = await import_plants(session, parse_cached_sites())
    return {
        "data": {
            "sites_imported_or_refreshed": count,
            "source": "EIA-860M August 2026 cached snapshot",
        }
    }


@router.get("/api/stream", tags=["events"])
async def stream_events(
    _: CrewPrincipal,
    request: Request,
    last_event_id: Annotated[int | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
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
