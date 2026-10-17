from __future__ import annotations

from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.entities import (
    Alert,
    AlertStatus,
    CrewReport,
    HazardObservation,
    RiskScore,
    SafetyBriefing,
    Site,
)
from app.services.events import publish_event
from app.services.ml import MLBriefing, MLClient


def _active_alert_query(site_id):
    return select(Alert).where(
        Alert.site_id == site_id,
        Alert.status.in_(
            [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED, AlertStatus.ALL_CLEAR_ELIGIBLE]
        ),
    )


def _valid_seconds(site: Site, prediction_date: date, now: datetime) -> int:
    zone = ZoneInfo(site.timezone)
    end_local = datetime.combine(prediction_date + timedelta(days=1), time.min, zone)
    return max(1, int((end_local.astimezone(UTC) - now).total_seconds()))


def _fallback_summary(site: Site, alerts: list[Alert], reports: list[CrewReport]) -> str:
    alert_text = (
        f" {len(alerts)} active alert{'s' if len(alerts) != 1 else ''} require review."
        if alerts
        else " No active alerts were recorded."
    )
    report_text = (
        f" Review {len(reports)} crew report{'s' if len(reports) != 1 else ''} received since the prior briefing."
        if reports
        else " No new crew reports were received since the prior briefing."
    )
    return (
        f"Next-day safety briefing for {site.name}. Follow established site procedures and verify "
        f"official warnings and current field conditions before work.{alert_text}{report_text}"
    )


async def _reports_since_previous(
    session: AsyncSession, site: Site, prediction_date: date, now: datetime
) -> tuple[list[CrewReport], datetime]:
    previous = await session.scalar(
        select(SafetyBriefing)
        .where(
            SafetyBriefing.site_id == site.id,
            SafetyBriefing.briefing_date < prediction_date,
        )
        .order_by(SafetyBriefing.generated_at.desc())
        .limit(1)
    )
    cutoff = previous.generated_at if previous else now - timedelta(hours=24)
    reports = (
        await session.scalars(
            select(CrewReport)
            .where(CrewReport.site_id == site.id, CrewReport.reported_at > cutoff)
            .order_by(CrewReport.reported_at)
        )
    ).all()
    return list(reports), cutoff


async def _latest_observations(
    session: AsyncSession, site: Site, now: datetime, stale_minutes: int
) -> tuple[dict, list[str]]:
    observations = (
        await session.scalars(
            select(HazardObservation)
            .where(HazardObservation.site_id == site.id)
            .order_by(HazardObservation.observed_at.desc())
            .limit(100)
        )
    ).all()
    latest: dict[str, dict] = {}
    for item in observations:
        latest.setdefault(
            item.metric_name,
            {
                "value": item.numeric_value,
                "unit": item.unit,
                "observed_at": item.observed_at.isoformat(),
                "source": item.source,
                "quality_status": item.quality_status.value,
                "is_estimated": item.is_estimated,
            },
        )
    warnings = []
    if not latest:
        warnings.append("No environmental observations were available when generated.")
    stale = [
        metric
        for metric, data in latest.items()
        if datetime.fromisoformat(data["observed_at"]) < now - timedelta(minutes=stale_minutes)
    ]
    if stale:
        warnings.append(f"Stale data: {', '.join(sorted(stale))}")
    return latest, warnings


def _provenance(
    status: str,
    risk_id,
    source: str,
    alerts: list[Alert],
    reports: list[CrewReport],
    cutoff: datetime,
    warnings: list[str],
    risk_status: str,
) -> dict:
    verification = Counter(report.verification_status for report in reports)
    hazards = Counter(report.hazard_type.value for report in reports)
    safe_source = source if source == "template" or source.startswith("gemini:") else "validated_ml"
    return {
        "generation_status": status,
        "risk_status": risk_status,
        "risk_score_id": str(risk_id) if risk_id else None,
        "briefing_source": safe_source,
        "validation": "ml_checker_passed" if status == "generated" else "deterministic",
        "report_cutoff": cutoff.isoformat(),
        "report_ids": [str(report.id) for report in reports],
        "report_counts": dict(hazards),
        "verification_counts": dict(verification),
        "active_alert_ids": [str(alert.id) for alert in alerts],
        "warnings": warnings,
    }


async def _persist_ml_result(
    session: AsyncSession,
    site: Site,
    prediction_date: date,
    now: datetime,
    result: MLBriefing,
    existing: SafetyBriefing | None,
    alerts: list[Alert],
    reports: list[CrewReport],
    cutoff: datetime,
) -> None:
    risk = await session.scalar(
        select(RiskScore).where(
            RiskScore.site_id == site.id,
            RiskScore.prediction_date == prediction_date,
            RiskScore.model_version == result.risk.model_version,
        )
    )
    factors = result.risk.contributing_factors()
    if risk is None:
        risk = RiskScore(
            site_id=site.id,
            prediction_date=prediction_date,
            score=result.risk.hazard_index,
            generated_at=now,
            valid_for_seconds=_valid_seconds(site, prediction_date, now),
            model_version=result.risk.model_version,
            score_source="ml_service",
            contributing_factors=factors,
        )
        session.add(risk)
        await session.flush()
    else:
        risk.score = result.risk.hazard_index
        risk.generated_at = now
        risk.valid_for_seconds = _valid_seconds(site, prediction_date, now)
        risk.score_source = "ml_service"
        risk.contributing_factors = factors
    publish_event(
        session,
        "risk.updated",
        {"site_id": str(site.id), "score_id": str(risk.id), "score": risk.score},
        site.id,
    )
    details = _provenance(
        "generated", risk.id, result.source, alerts, reports, cutoff, [], "available"
    )
    if existing:
        existing.summary = result.briefing
        existing.generated_at = now
        existing.hazard_details = details
        event = "briefing.updated"
    else:
        session.add(
            SafetyBriefing(
                site_id=site.id,
                briefing_date=prediction_date,
                generated_at=now,
                summary=result.briefing,
                hazard_details=details,
            )
        )
        event = "briefing.created"
    publish_event(session, event, {"date": prediction_date.isoformat()}, site.id)


async def generate_due_briefings(
    session: AsyncSession,
    now: datetime | None = None,
    stale_minutes: int = 60,
    settings: Settings | None = None,
    ml_client: MLClient | None = None,
    site_id=None,
) -> int:
    now = now or datetime.now(UTC)
    settings = settings or Settings(ml_enabled=False)
    client = ml_client or (MLClient(settings) if settings.ml_enabled else None)
    query = select(Site).where(Site.id == site_id) if site_id else select(Site)
    sites = (await session.scalars(query)).all()
    count = 0
    for site in sites:
        local_now = now.astimezone(ZoneInfo(site.timezone))
        if local_now.hour < 18:
            continue
        prediction_date = local_now.date() + timedelta(days=1)
        lock_key = site.eia_plant_id * 100000 + prediction_date.toordinal() % 100000
        if not await session.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": lock_key}):
            continue
        existing = await session.scalar(
            select(SafetyBriefing).where(
                SafetyBriefing.site_id == site.id,
                SafetyBriefing.briefing_date == prediction_date,
            )
        )
        if existing:
            details = existing.hazard_details or {}
            if details.get("generation_status") == "generated" or details.get("risk_status") == "unsupported":
                continue
        alerts = list((await session.scalars(_active_alert_query(site.id))).all())
        reports, cutoff = await _reports_since_previous(
            session, site, prediction_date, now
        )
        latest, warnings = await _latest_observations(session, site, now, stale_minutes)
        if client and site.ml_supported:
            try:
                result = await client.briefing(site, prediction_date, alerts, reports)
            except Exception:  # noqa: BLE001 - a safe fallback must survive any service failure
                warnings.append("ML prediction was unavailable; a deterministic briefing was used.")
                risk_status = "unavailable"
            else:
                await _persist_ml_result(
                    session, site, prediction_date, now, result, existing, alerts, reports, cutoff
                )
                count += 1
                continue
        else:
            risk_status = "unsupported" if not site.ml_supported else "unavailable"
            if not site.ml_supported:
                warnings.append("This site is not covered by the current ML model catalog.")
        details = _provenance(
            "fallback", None, "template", alerts, reports, cutoff, warnings, risk_status
        )
        details["latest_data"] = latest
        if existing:
            existing.summary = _fallback_summary(site, alerts, reports)
            existing.generated_at = now
            existing.hazard_details = details
            event = "briefing.updated"
        else:
            session.add(
                SafetyBriefing(
                    site_id=site.id,
                    briefing_date=prediction_date,
                    generated_at=now,
                    summary=_fallback_summary(site, alerts, reports),
                    hazard_details=details,
                )
            )
            event = "briefing.created"
        publish_event(session, event, {"date": prediction_date.isoformat()}, site.id)
        count += 1
    return count
