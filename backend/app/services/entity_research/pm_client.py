"""REST client for the propaganda-model research queue (Epic 12 "Wie is dit?", Story 12.7).

The news backend only WRITES to the propaganda model through its REST API, under its own agent
account ``nieuws-agent`` (Bearer token file in the propaganda-model project). Everything it
enqueues is a research target; the research itself (and every proposal) is done by the
propaganda-model agent ``nieuws-scout``.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

import httpx

from backend.app.core.logging import get_logger

logger = get_logger(__name__).bind(component="PmClient")


class PmApiError(RuntimeError):
    """The propaganda-model API answered with an unexpected status."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code
        self.message = message


class PmApiUnavailableError(RuntimeError):
    """The propaganda-model server is not reachable (not running) or no token is configured."""


class PmApiRateLimitError(PmApiError):
    """Write rate limit of the account reached (429): try again next cycle."""


def read_token(path: Path | str) -> str | None:
    """Token from a token file (never logged); None when the file is missing or empty."""

    try:
        token = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return token or None


class PmClient:
    """Thin async client: health check and the ``nieuws_doelen`` queue."""

    def __init__(
        self,
        base_url: str,
        token_path: Path | str,
        *,
        timeout: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
        token_reader: Callable[[Path | str], str | None] = read_token,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token_path = token_path
        self.timeout = timeout
        self._transport = transport
        self._token_reader = token_reader

    def _client(self, token: str | None = None) -> httpx.AsyncClient:
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=self.timeout,
            transport=self._transport,
        )

    def _token(self) -> str:
        token = self._token_reader(self.token_path)
        if not token:
            raise PmApiUnavailableError(f"no propaganda-model token at {self.token_path}")
        return token

    async def health(self) -> bool:
        """True when the propaganda-model server answers."""

        try:
            async with self._client() as client:
                response = await client.get("/api/health")
        except httpx.HTTPError:
            return False
        return response.status_code < 500

    async def enqueue(self, doel: Mapping[str, Any], *, again: bool = False) -> dict[str, Any]:
        """POST /api/nieuws/doelen. Returns ``{"doel": {...}, "created": bool}``.

        A finished target answers 409; with ``again=True`` it is reopened.
        """

        payload = dict(doel)
        if again:
            payload["opnieuw"] = True
        try:
            async with self._client(self._token()) as client:
                response = await client.post("/api/nieuws/doelen", json=payload)
        except httpx.HTTPError as exc:
            raise PmApiUnavailableError(str(exc)) from exc
        body = _json(response)
        if response.status_code in (200, 201):
            return {"doel": body.get("doel") or {}, "created": response.status_code == 201}
        if response.status_code == 409:
            return {"doel": body.get("doel") or {}, "created": False, "finished": True}
        if response.status_code == 429:
            raise PmApiRateLimitError(429, str(body.get("error") or "rate limit"))
        raise PmApiError(response.status_code, str(body.get("error") or response.text[:200]))

    async def prioritise(self, relation_ids: Sequence[int]) -> int:
        """POST /api/nieuws/voorrang: links readers see go first in the propaganda model's
        automatic check and source search. Returns how many it took (unknown ids are ignored)."""

        payload = {"relation_ids": [int(i) for i in relation_ids]}
        try:
            async with self._client(self._token()) as client:
                response = await client.post("/api/nieuws/voorrang", json=payload)
        except httpx.HTTPError as exc:
            raise PmApiUnavailableError(str(exc)) from exc
        body = _json(response)
        if response.status_code == 200:
            return int(body.get("bijgewerkt") or 0)
        raise PmApiError(response.status_code, str(body.get("error") or response.text[:200]))


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


__all__ = [
    "PmApiError",
    "PmApiRateLimitError",
    "PmApiUnavailableError",
    "PmClient",
    "read_token",
]
