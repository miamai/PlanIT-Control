from __future__ import annotations

from collections.abc import Sequence

from app.models.entities import Site
from app.providers.base import LightningProvider
from app.schemas.domain import LightningStrikeInput


class FixtureLightningProvider(LightningProvider):
    """Explicit test/demo adapter. It never invents strikes during normal polling."""

    name = "planit_fixture"

    def __init__(self, fixtures: list[LightningStrikeInput] | None = None) -> None:
        self.fixtures = fixtures or []

    async def fetch_strikes(self, sites: Sequence[Site]) -> list[LightningStrikeInput]:
        del sites
        strikes, self.fixtures = self.fixtures, []
        return strikes
