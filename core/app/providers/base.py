from __future__ import annotations

import abc
from collections.abc import Sequence

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_random_exponential

from app.models.entities import Site
from app.schemas.domain import LightningStrikeInput, NormalizedObservation


class ProviderError(RuntimeError):
    pass


class EnvironmentalProvider(abc.ABC):
    name: str

    @abc.abstractmethod
    async def fetch(self, sites: Sequence[Site]) -> list[NormalizedObservation]: ...


class LightningProvider(abc.ABC):
    name: str

    @abc.abstractmethod
    async def fetch_strikes(self, sites: Sequence[Site]) -> list[LightningStrikeInput]: ...


class SoilProvider(EnvironmentalProvider, abc.ABC):
    pass


class RetryingHTTPProvider:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError, ProviderError)),
        wait=wait_random_exponential(multiplier=0.5, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def get_response(self, url: str, **kwargs) -> httpx.Response:
        response = await self.client.get(url, **kwargs)
        if response.status_code == 429:
            raise ProviderError(
                f"Provider rate limited request; retry-after={response.headers.get('retry-after')}"
            )
        if response.status_code >= 500:
            raise ProviderError(f"Provider server error: {response.status_code}")
        response.raise_for_status()
        return response

    async def get_json(self, url: str, **kwargs) -> dict:
        response = await self.get_response(url, **kwargs)
        return response.json()
