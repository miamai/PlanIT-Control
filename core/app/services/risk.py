from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import HazardObservation


async def historical_features(
    session: AsyncSession, site_id: uuid.UUID, start: datetime, end: datetime
) -> dict:
    rows = (
        await session.scalars(
            select(HazardObservation).where(
                HazardObservation.site_id == site_id,
                HazardObservation.observed_at >= start,
                HazardObservation.observed_at < end,
            )
        )
    ).all()
    features: dict[str, dict] = {}
    for row in rows:
        bucket = features.setdefault(
            row.metric_name, {"count": 0, "minimum": None, "maximum": None, "latest": None}
        )
        bucket["count"] += 1
        if row.numeric_value is not None:
            bucket["minimum"] = (
                row.numeric_value
                if bucket["minimum"] is None
                else min(bucket["minimum"], row.numeric_value)
            )
            bucket["maximum"] = (
                row.numeric_value
                if bucket["maximum"] is None
                else max(bucket["maximum"], row.numeric_value)
            )
        if bucket["latest"] is None or row.observed_at > bucket["latest"]["observed_at"]:
            bucket["latest"] = {
                "value": row.numeric_value,
                "unit": row.unit,
                "observed_at": row.observed_at,
                "is_estimated": row.is_estimated,
                "source": row.source,
            }
    return {
        "schema_version": "1.0",
        "site_id": str(site_id),
        "window": {"start": start, "end": end},
        "features": features,
    }


class ModelInferenceAdapter:
    async def predict(self, features: dict) -> dict:
        raise RuntimeError("No trained model inference adapter is configured")
