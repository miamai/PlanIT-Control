from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.entities import (
    Alert,
    AlertStatus,
    AlertTransition,
    HazardObservation,
    HazardType,
    LightningSiteState,
    LightningStrike,
    QualityStatus,
    Severity,
    Site,
)
from app.schemas.domain import LightningStrikeInput
from app.services.events import publish_event
from app.utils.geo import haversine_miles


async def process_strike(
    session: AsyncSession, strike_input: LightningStrikeInput, settings: Settings
) -> list[Alert]:
    strike_id = await session.scalar(
        insert(LightningStrike)
        .values(
            strike_id=strike_input.strike_id,
            latitude=strike_input.latitude,
            longitude=strike_input.longitude,
            occurred_at=strike_input.occurred_at,
            provider=strike_input.provider,
            metadata_=strike_input.metadata,
        )
        .on_conflict_do_nothing(index_elements=["provider", "strike_id"])
        .returning(LightningStrike.id)
    )
    if strike_id is None:
        return []

    sites = (await session.scalars(select(Site))).all()
    changed: list[Alert] = []
    for site in sites:
        distance = haversine_miles(
            site.latitude, site.longitude, strike_input.latitude, strike_input.longitude
        )
        if distance > settings.lightning_radius_miles:
            continue
        state = await session.scalar(
            select(LightningSiteState)
            .where(LightningSiteState.site_id == site.id)
            .with_for_update()
        )
        if state and strike_input.occurred_at <= state.latest_qualifying_strike_at:
            continue

        synthetic = bool(strike_input.metadata.get("synthetic_notice")) or (
            strike_input.provider.lower() == "fixture"
        )
        await session.execute(
            insert(HazardObservation)
            .values(
                site_id=site.id,
                hazard_type=HazardType.LIGHTNING,
                source=strike_input.provider,
                source_event_id=strike_input.strike_id,
                observed_at=strike_input.occurred_at,
                metric_name="lightning_strike_distance",
                numeric_value=distance,
                unit="miles",
                latitude=strike_input.latitude,
                longitude=strike_input.longitude,
                metadata_={
                    **strike_input.metadata,
                    "stop_work_radius_miles": settings.lightning_radius_miles,
                    "fixture": synthetic,
                },
                quality_status=(
                    QualityStatus.SYNTHETIC if synthetic else QualityStatus.PROVISIONAL
                ),
                is_estimated=False,
            )
            .on_conflict_do_nothing(
                index_elements=[
                    "site_id",
                    "source",
                    "source_event_id",
                    "metric_name",
                    "observed_at",
                ]
            )
        )

        eligible_at = strike_input.occurred_at + timedelta(
            minutes=settings.lightning_all_clear_minutes
        )
        alert = None
        if state and state.alert_id:
            alert = await session.get(Alert, state.alert_id, with_for_update=True)
        if alert is None or alert.status == AlertStatus.RESOLVED:
            alert = Alert(
                site_id=site.id,
                hazard_type=HazardType.LIGHTNING,
                severity=Severity.CRITICAL,
                status=AlertStatus.ACTIVE,
                action_code="STOP_WORK",
                title="Lightning stop-work condition",
                message=f"Lightning detected {distance:.2f} miles from {site.name}.",
                recommended_action=(
                    "Stop exposed work and follow the site's established lightning safety procedure."
                ),
                triggered_at=strike_input.occurred_at,
                expires_at=eligible_at,
                source_reference=f"{strike_input.provider}:{strike_input.strike_id}",
                details={"distance_miles": round(distance, 3)},
            )
            session.add(alert)
            await session.flush()
            session.add(
                AlertTransition(
                    alert_id=alert.id,
                    from_status=None,
                    to_status=AlertStatus.ACTIVE,
                    reason="Qualifying lightning strike",
                    source_reference=alert.source_reference,
                )
            )
        else:
            old_status = alert.status
            alert.status = AlertStatus.ACTIVE
            alert.updated_at = datetime.now(UTC)
            alert.expires_at = eligible_at
            alert.message = f"Lightning detected {distance:.2f} miles from {site.name}."
            alert.source_reference = f"{strike_input.provider}:{strike_input.strike_id}"
            alert.details = {"distance_miles": round(distance, 3), "countdown_reset": True}
            session.add(
                AlertTransition(
                    alert_id=alert.id,
                    from_status=old_status,
                    to_status=AlertStatus.ACTIVE,
                    reason="Countdown reset by newer qualifying strike",
                    source_reference=alert.source_reference,
                )
            )

        if state is None:
            state = LightningSiteState(
                site_id=site.id,
                alert_id=alert.id,
                latest_strike_id=strike_input.strike_id,
                latest_qualifying_strike_at=strike_input.occurred_at,
                all_clear_eligible_at=eligible_at,
            )
            session.add(state)
        else:
            state.alert_id = alert.id
            state.latest_strike_id = strike_input.strike_id
            state.latest_qualifying_strike_at = strike_input.occurred_at
            state.all_clear_eligible_at = eligible_at
            state.updated_at = datetime.now(UTC)
        publish_event(
            session,
            "alert.lightning.updated",
            {
                "alert_id": str(alert.id),
                "site_id": str(site.id),
                "status": AlertStatus.ACTIVE.value,
                "all_clear_eligible_at": eligible_at.isoformat(),
                "distance_miles": round(distance, 3),
            },
            site.id,
        )
        changed.append(alert)
    return changed


async def expire_lightning_alerts(
    session: AsyncSession, now: datetime | None = None
) -> list[Alert]:
    now = now or datetime.now(UTC)
    states = (
        await session.scalars(
            select(LightningSiteState)
            .where(LightningSiteState.all_clear_eligible_at <= now)
            .with_for_update(skip_locked=True)
        )
    ).all()
    changed: list[Alert] = []
    for state in states:
        alert = await session.get(Alert, state.alert_id, with_for_update=True)
        if alert is None or alert.status not in {AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED}:
            continue
        previous = alert.status
        alert.status = AlertStatus.ALL_CLEAR_ELIGIBLE
        alert.updated_at = now
        session.add(
            AlertTransition(
                alert_id=alert.id,
                from_status=previous,
                to_status=AlertStatus.ALL_CLEAR_ELIGIBLE,
                reason="Thirty minutes elapsed after latest qualifying strike; authorization required",
                source_reference=alert.source_reference,
            )
        )
        publish_event(
            session,
            "alert.lightning.all_clear_eligible",
            {
                "alert_id": str(alert.id),
                "site_id": str(alert.site_id),
                "status": alert.status.value,
            },
            alert.site_id,
        )
        changed.append(alert)
    return changed
