"""Playwright-based article fetching for JavaScript-rendered pages."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from structlog.stdlib import BoundLogger

from backend.app.core.logging import get_logger

# Lazy import to avoid startup overhead when not used
_playwright_module = None
_stealth_module = None


def _get_playwright():
    global _playwright_module
    if _playwright_module is None:
        from playwright.async_api import async_playwright
        _playwright_module = async_playwright
    return _playwright_module


def _get_stealth():
    global _stealth_module
    if _stealth_module is None:
        from playwright_stealth import Stealth
        _stealth_module = Stealth
    return _stealth_module


class PlaywrightFetchError(Exception):
    """Raised when Playwright fails to fetch article content."""


class PlaywrightBrowserPool:
    """Manages a pool of browser contexts for efficient page fetching."""

    def __init__(self, max_contexts: int = 3):
        self._browser = None
        self._playwright = None
        self._lock = asyncio.Lock()
        self._max_contexts = max_contexts
        self._logger = get_logger(__name__)

    async def _ensure_browser(self) -> None:
        """Ensure browser is running, start if needed."""
        if self._browser is None or not self._browser.is_connected():
            async with self._lock:
                if self._browser is None or not self._browser.is_connected():
                    self._logger.info("playwright_browser_starting")
                    playwright_fn = _get_playwright()
                    self._playwright = await playwright_fn().start()
                    self._browser = await self._playwright.chromium.launch(
                        headless=True,
                        args=[
                            "--disable-dev-shm-usage",
                            "--no-sandbox",
                            "--disable-setuid-sandbox",
                            "--disable-gpu",
                        ],
                    )
                    self._logger.info("playwright_browser_started")

    @asynccontextmanager
    async def get_context(self) -> AsyncIterator:
        """Get a browser context for fetching pages."""
        await self._ensure_browser()

        context = await self._browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            java_script_enabled=True,
        )

        try:
            yield context
        finally:
            await context.close()

    async def close(self) -> None:
        """Close browser and cleanup resources."""
        if self._browser:
            self._logger.info("playwright_browser_closing")
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None


# Global browser pool instance
_browser_pool: Optional[PlaywrightBrowserPool] = None


def get_browser_pool() -> PlaywrightBrowserPool:
    """Get or create the global browser pool."""
    global _browser_pool
    if _browser_pool is None:
        _browser_pool = PlaywrightBrowserPool()
    return _browser_pool


async def close_browser_pool() -> None:
    """Close the global browser pool. Call on application shutdown."""
    global _browser_pool
    if _browser_pool:
        await _browser_pool.close()
        _browser_pool = None


async def fetch_with_playwright(
    url: str,
    *,
    timeout_ms: int = 30000,
    wait_for_selector: Optional[str] = None,
    logger: Optional[BoundLogger] = None,
) -> str:
    """
    Fetch article HTML using Playwright for JavaScript-rendered pages.

    Args:
        url: The article URL to fetch
        timeout_ms: Page load timeout in milliseconds (default 30s)
        wait_for_selector: Optional CSS selector to wait for before extracting content
        logger: Optional structured logger

    Returns:
        The rendered HTML content of the page

    Raises:
        PlaywrightFetchError: When fetching fails
    """
    log = (logger or get_logger(__name__)).bind(url=url)
    pool = get_browser_pool()

    try:
        async with pool.get_context() as context:
            page = await context.new_page()

            # Apply stealth to reduce bot detection
            Stealth = _get_stealth()
            stealth = Stealth()
            await stealth.apply_stealth_async(page)

            # Block unnecessary resources for faster loading
            await page.route(
                "**/*",
                lambda route: (
                    route.abort()
                    if route.request.resource_type in ["image", "media", "font", "stylesheet"]
                    else route.continue_()
                ),
            )

            log.debug("playwright_navigating", timeout_ms=timeout_ms)

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            except Exception as nav_error:
                log.warning("playwright_navigation_timeout", error=str(nav_error))
                # Try to continue anyway, page might have partially loaded

            # Wait a moment for consent dialog to appear
            await asyncio.sleep(1)

            # Handle consent dialogs (common for Dutch news sites)
            try:
                # Try common consent button patterns
                consent_button = await page.query_selector(
                    'button:has-text("Akkoord"), '
                    'button:has-text("Accept"), '
                    '[data-testid="uc-accept-all-button"]'
                )
                if consent_button:
                    log.debug("playwright_clicking_consent")
                    await consent_button.click()
                    await asyncio.sleep(1)
            except Exception:
                pass  # No consent dialog or click failed, continue

            # Wait for content if selector specified
            if wait_for_selector:
                try:
                    await page.wait_for_selector(wait_for_selector, timeout=10000)
                except Exception:
                    log.debug("playwright_selector_timeout", selector=wait_for_selector)

            # Give JavaScript a moment to render
            await asyncio.sleep(1)

            # Get the rendered HTML
            html = await page.content()

            log.info(
                "playwright_fetch_complete",
                html_length=len(html),
            )

            return html

    except Exception as exc:
        log.error("playwright_fetch_failed", error=str(exc))
        raise PlaywrightFetchError(f"Failed to fetch {url} with Playwright: {exc}") from exc


__all__ = [
    "fetch_with_playwright",
    "PlaywrightFetchError",
    "get_browser_pool",
    "close_browser_pool",
]
