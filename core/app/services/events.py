from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import EventOutbox


def publish_event(
    session: AsyncSession,
    event_type: str,
    payload: dict[str, Any],
    site_id: uuid.UUID | None = None,
) -> EventOutbox:
    event = EventOutbox(event_type=event_type, payload=payload, site_id=site_id)
    session.add(event)
    return event
