"""Async HTTP fetching utilities for article content."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import AsyncIterator, Optional

import httpx
from httpx import URL
from structlog.stdlib import BoundLogger
from tenacity import AsyncRetrying, RetryError, retry_if_exception_type, stop_after_attempt, wait_exponential

from backend.app.core.logging import get_logger
from backend.app.ingestion.profiles import (
    SourceProfile,
    load_persisted_cookies,
    persist_cookies,
)
from backend.app.ingestion.playwright_fetch import (
    fetch_with_playwright,
    PlaywrightFetchError,
)

DEFAULT_TIMEOUT = 15.0
USER_AGENT = "News360Ingest/0.1 (+https://github.com/news-360/mvp)"
CONSENT_REDIRECT_DOMAINS = ("myprivacy.",)


class ArticleFetchError(Exception):
    """Raised when an article cannot be fetched after retries."""


DEFAULT_PROFILE = SourceProfile(
    id="default",
    fetch_strategy="simple",
    user_agent=USER_AGENT,
    parser="trafilatura",
    cookie_ttl_minutes=0,
)


@asynccontextmanager
async def _client_context(
    profile: SourceProfile,
    client: Optional[httpx.AsyncClient] = None,
    *,
    timeout: float,
) -> AsyncIterator[httpx.AsyncClient]:
    if client is not None:
        yield client
        return

    headers = {"User-Agent": profile.user_agent or USER_AGENT}
    if profile.headers:
        headers.update(profile.headers)

    async with httpx.AsyncClient(
        timeout=timeout,
        headers=headers,
        follow_redirects=False,
    ) as owned_client:
        yield owned_client


def _apply_persisted_cookies(
    client: httpx.AsyncClient,
    profile: SourceProfile,
    *,
    cookies_dir: Optional[Path],
    log: BoundLogger,
) -> None:
    payload = load_persisted_cookies(profile.id, base_dir=cookies_dir)
    if not payload:
        return

    ttl_minutes = profile.cookie_ttl_minutes if profile.cookie_ttl_minutes is not None else payload.get("ttl_minutes")
    stored_at = payload.get("stored_at")

    if ttl_minutes and stored_at:
        try:
            stored_dt = datetime.fromisoformat(stored_at)
        except ValueError:  # pragma: no cover - defensive
            stored_dt = None
        if stored_dt and datetime.now(timezone.utc) - stored_dt > timedelta(minutes=ttl_minutes):
            log.debug("cookies_expired", source=profile.id)
            return

    for cookie in payload.get("cookies", []):
        name = cookie.get("name")
        value = cookie.get("value")
        if not name or value is None:
            continue
        client.cookies.set(
            name,
            value,
            domain=cookie.get("domain"),
            path=cookie.get("path", "/"),
        )

    log.debug("cookies_loaded", source=profile.id, count=len(payload.get("cookies", [])))


def _persist_client_cookies(
    client: httpx.AsyncClient,
    profile: SourceProfile,
    *,
    cookies_dir: Optional[Path],
    log: BoundLogger,
) -> None:
    if profile.cookie_ttl_minutes == 0:
        return

    jar = getattr(client.cookies, "jar", None)
    if not jar:
        return

    cookies = []
    for cookie in jar:
        cookies.append(
            {
                "name": cookie.name,
                "value": cookie.value,
                "domain": cookie.domain,
                "path": cookie.path,
                "expires": cookie.expires,
            }
        )

    if not cookies:
        return

    payload = {
        "stored_at": datetime.now(timezone.utc).isoformat(),
        "ttl_minutes": profile.cookie_ttl_minutes,
        "cookies": cookies,
    }
    persist_cookies(profile.id, payload, base_dir=cookies_dir)
    log.debug("cookies_persisted", source=profile.id, count=len(cookies))


def _is_consent_location(location: str, profile: SourceProfile) -> bool:
    if not profile.consent:
        return False
    try:
        host = URL(location).host
    except ValueError:
        return False
    consent_host = URL(str(profile.consent.endpoint)).host
    if host and consent_host and consent_host == host:
        return True
    return any(domain in (host or "") for domain in CONSENT_REDIRECT_DOMAINS)


async def _handle_consent(
    client: httpx.AsyncClient,
    location: str,
    target_url: str,
    profile: SourceProfile,
    *,
    timeout: float,
    log: BoundLogger,
) -> None:
    if not profile.consent:
        return

    log.info("consent_flow_start", location=location)

    try:
        await client.get(location, timeout=timeout, follow_redirects=True)
    except httpx.HTTPError as exc:
        log.warning("consent_probe_failed", error=str(exc))

    consent = profile.consent
    params = {k: v.format(article_url=target_url) for k, v in consent.params.items()}
    headers = consent.headers or None
    method = consent.method.upper()
    request_kwargs = {
        "timeout": timeout,
        "follow_redirects": True,
        "headers": headers,
    }

    if method == "POST":
        await client.post(str(consent.endpoint), data=params or None, **request_kwargs)
    else:
        await client.get(str(consent.endpoint), params=params or None, **request_kwargs)

    log.info("consent_flow_complete", endpoint=str(consent.endpoint))


async def _basic_fetch(
    client: httpx.AsyncClient,
    url: str,
    *,
    timeout: float,
    follow_redirects: bool,
) -> httpx.Response:
    response = await client.get(url, timeout=timeout, follow_redirects=follow_redirects)
    response.raise_for_status()
    return response


async def _fetch_with_consent(
    client: httpx.AsyncClient,
    url: str,
    profile: SourceProfile,
    *,
    timeout: float,
    log: BoundLogger,
) -> httpx.Response:
    response = await client.get(url, timeout=timeout, follow_redirects=False)

    if response.status_code in {301, 302, 303, 307, 308}:
        location = response.headers.get("Location")
        if location and profile.consent:
            await _handle_consent(client, location, url, profile, timeout=timeout, log=log)
            response = await client.get(url, timeout=timeout, follow_redirects=True)
        else:
            response = await client.get(url, timeout=timeout, follow_redirects=True)
    elif response.status_code == 200:
        host = response.url.host or ""
        if profile.consent and any(domain in host for domain in CONSENT_REDIRECT_DOMAINS):
            await _handle_consent(client, str(response.url), url, profile, timeout=timeout, log=log)
            response = await client.get(url, timeout=timeout, follow_redirects=True)
    else:
        response = await client.get(url, timeout=timeout, follow_redirects=True)

    response.raise_for_status()
    return response


async def fetch_article_html(
    url: str,
    *,
    profile: Optional[SourceProfile] = None,
    client: Optional[httpx.AsyncClient] = None,
    timeout: float = DEFAULT_TIMEOUT,
    logger: Optional[BoundLogger] = None,
    cookies_dir: Optional[Path] = None,
) -> str:
    """Fetch article HTML with retries, consent handling, and structured logging."""

    resolved_profile = profile or DEFAULT_PROFILE
    log = (logger or get_logger(__name__)).bind(url=url, source=resolved_profile.id)

    # Route to Playwright for JavaScript-rendered pages
    if resolved_profile.fetch_strategy == "playwright":
        log.debug("using_playwright_fetch")
        try:
            return await fetch_with_playwright(
                url,
                timeout_ms=int(timeout * 1000),
                logger=log,
            )
        except PlaywrightFetchError as exc:
            log.warning("playwright_fetch_failed", error=str(exc))
            raise ArticleFetchError(f"Playwright failed to fetch article from {url}") from exc

    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            retry=retry_if_exception_type(httpx.RequestError),
            reraise=True,
        ):
            with attempt:
                log.debug("fetching_article_html", attempt=attempt.retry_state.attempt_number)
                async with _client_context(resolved_profile, client, timeout=timeout) as active_client:
                    _apply_persisted_cookies(active_client, resolved_profile, cookies_dir=cookies_dir, log=log)

                    if resolved_profile.fetch_strategy == "consent_cookie":
                        response = await _fetch_with_consent(
                            active_client,
                            url,
                            resolved_profile,
                            timeout=timeout,
                            log=log,
                        )
                    else:
                        response = await _basic_fetch(
                            active_client,
                            url,
                            timeout=timeout,
                            follow_redirects=True,
                        )

                    _persist_client_cookies(active_client, resolved_profile, cookies_dir=cookies_dir, log=log)
                    return response.text
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
