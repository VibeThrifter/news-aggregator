"""Async HTTP fetching utilities for article content."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import httpx
from structlog.stdlib import BoundLogger
from tenacity import AsyncRetrying, RetryError, retry_if_exception_type, stop_after_attempt, wait_exponential

from backend.app.core.logging import get_logger

DEFAULT_TIMEOUT = 15.0
USER_AGENT = "News360Ingest/0.1 (+https://github.com/news-360/mvp)"


class ArticleFetchError(Exception):
    """Raised when an article cannot be fetched after retries."""


@asynccontextmanager
async def _maybe_client(
    client: Optional[httpx.AsyncClient] = None,
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> AsyncIterator[httpx.AsyncClient]:
    if client is not None:
        yield client
        return

    async with httpx.AsyncClient(
        timeout=timeout,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    ) as owned_client:
        yield owned_client


async def _perform_fetch(client: httpx.AsyncClient, url: str, *, timeout: float) -> str:
    response = await client.get(url, timeout=timeout)
    response.raise_for_status()
    return response.text


async def fetch_article_html(
    url: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    timeout: float = DEFAULT_TIMEOUT,
    logger: Optional[BoundLogger] = None,
) -> str:
    """Fetch article HTML with retries and structured logging."""

    log = logger or get_logger(__name__).bind(url=url)

    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            retry=retry_if_exception_type(httpx.RequestError),
            reraise=True,
        ):
            with attempt:
                log.debug("fetching_article_html", attempt=attempt.retry_state.attempt_number)
                async with _maybe_client(client, timeout=timeout) as active_client:
                    return await _perform_fetch(active_client, url, timeout=timeout)
    except RetryError as exc:
        last_exc = exc.last_attempt.exception()
        log.warning(
            "article_fetch_failed",
            error=str(last_exc),
            attempts=exc.last_attempt.retry_state.attempt_number,
        )
        raise ArticleFetchError(f"Failed to fetch article from {url}") from last_exc
    except httpx.HTTPStatusError as exc:
        log.warning(
            "article_fetch_http_error",
            status_code=exc.response.status_code,
            error=str(exc),
        )
        raise ArticleFetchError(f"HTTP error fetching article from {url}") from exc

    raise ArticleFetchError(f"Unable to fetch article from {url}")
