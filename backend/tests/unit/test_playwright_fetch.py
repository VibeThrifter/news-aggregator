"""Unit tests for Playwright-based article fetching."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.ingestion.fetcher import fetch_article_html
from backend.app.ingestion.playwright_fetch import (
    STATIC_FILES,
    PlaywrightBrowserPool,
    PlaywrightFetchError,
    fetch_with_playwright,
)
from backend.app.ingestion.profiles import SourceProfile


class TestPlaywrightBrowserPool:
    """Tests for PlaywrightBrowserPool class."""

    @pytest.mark.asyncio
    async def test_browser_pool_initialization(self):
        """Test that pool initializes without browser."""
        pool = PlaywrightBrowserPool()
        assert pool._browser is None
        assert pool._playwright is None

    @pytest.mark.asyncio
    async def test_browser_pool_close_when_not_started(self):
        """Test that close() handles not-yet-started browser gracefully."""
        pool = PlaywrightBrowserPool()
        await pool.close()
        assert pool._browser is None


    @pytest.mark.asyncio
    async def test_contexts_beyond_the_limit_wait_their_turn(self):
        """A poll fetches from every Playwright source at once: max_contexts pages load together."""
        pool = PlaywrightBrowserPool(max_contexts=2)
        pool._ensure_browser = AsyncMock()
        pool._browser = MagicMock()
        pool._browser.new_context = AsyncMock(side_effect=lambda **_: AsyncMock())
        open_now = 0
        most_open = 0

        async def fetch():
            nonlocal open_now, most_open
            async with pool.get_context():
                open_now += 1
                most_open = max(most_open, open_now)
                await asyncio.sleep(0.01)
                open_now -= 1

        await asyncio.gather(*(fetch() for _ in range(5)))

        assert most_open == 2
        assert pool._browser.new_context.await_count == 5


def _page_on(url: str, html: str) -> MagicMock:
    page = MagicMock()
    page.url = url
    page.goto = AsyncMock()
    page.route = AsyncMock()
    page.query_selector = AsyncMock(return_value=None)
    page.wait_for_url = AsyncMock()
    page.content = AsyncMock(return_value=html)
    return page


@contextmanager
def _browser_showing(page: MagicMock):
    context = MagicMock()
    context.new_page = AsyncMock(return_value=page)

    @asynccontextmanager
    async def get_context():
        yield context

    pool = MagicMock()
    pool.get_context = get_context
    stealth = AsyncMock()
    with patch("backend.app.ingestion.playwright_fetch.get_browser_pool", return_value=pool), patch(
        "backend.app.ingestion.playwright_fetch._get_stealth", return_value=stealth
    ), patch("backend.app.ingestion.playwright_fetch.asyncio.sleep", new=AsyncMock()):
        yield stealth


class TestDpgPrivacyGate:
    """DPG (Volkskrant, Parool, Trouw, AD, NU.nl) first sends a new browser to its privacy gate."""

    GATE = "https://myprivacy.dpgmedia.nl/consent?siteKey=x&callbackUrl=https%3A%2F%2Fwww.trouw.nl%2Fprivacygate-confirm"
    ARTICLE = "https://www.trouw.nl/zorg/mantelzorgers~b00bf427/"

    @pytest.mark.asyncio
    async def test_waits_until_the_gate_sends_the_browser_back(self):
        page = _page_on(self.GATE, "<html>artikel</html>")

        async def back_to_article(*_args, **_kwargs):
            page.url = self.ARTICLE

        page.wait_for_url.side_effect = back_to_article

        with _browser_showing(page):
            html = await fetch_with_playwright(self.ARTICLE)

        assert html == "<html>artikel</html>"
        page.wait_for_url.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_page_still_on_the_gate_is_a_failed_fetch(self):
        """The gate's HTML is no article: the fetch fails (RSS summary or the next poll instead)."""
        page = _page_on(self.GATE, "<html>privacy gate</html>")
        page.wait_for_url.side_effect = TimeoutError("Timeout 15000ms exceeded.")

        with _browser_showing(page), pytest.raises(PlaywrightFetchError, match="privacy gate"):
            await fetch_with_playwright(self.ARTICLE)

        page.content.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_article_page_is_not_waited_for(self):
        page = _page_on(self.ARTICLE, "<html>artikel</html>")

        with _browser_showing(page):
            html = await fetch_with_playwright(self.ARTICLE)

        assert html == "<html>artikel</html>"
        page.wait_for_url.assert_not_awaited()


class TestStaticFiles:
    """Only images, fonts and media go through the route; the rest never waits on Python."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://images.dpgmedia.nl/foto.jpg?width=640",
            "https://www.trouw.nl/fonts/Lora.woff2",
            "https://cdn.example.com/clip.mp4",
            "https://www.ad.nl/logo.SVG",
        ],
    )
    def test_blocks_images_fonts_and_media(self, url):
        assert STATIC_FILES.search(url)

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.trouw.nl/zorg/mantelzorgers~b00bf427/",
            "https://myprivacy.dpgmedia.nl/consent?siteKey=x",
            "https://www.trouw.nl/static/app.js",
            "https://www.trouw.nl/static/site.css",
            "https://www.trouw.nl/jpg-nieuws/artikel~b1/",
        ],
    )
    def test_lets_pages_scripts_and_styles_through(self, url):
        assert not STATIC_FILES.search(url)


class TestPlaywrightFetchError:
    """Tests for PlaywrightFetchError exception."""

    def test_error_message_formatting(self):
        """Test that PlaywrightFetchError formats messages correctly."""
        error = PlaywrightFetchError("Browser crashed for https://example.com")
        assert "Browser crashed" in str(error)
        assert "example.com" in str(error)

    def test_error_inheritance(self):
        """Test that PlaywrightFetchError inherits from Exception."""
        error = PlaywrightFetchError("test")
        assert isinstance(error, Exception)


class TestFetcherPlaywrightIntegration:
    """Tests for Playwright strategy integration in fetcher.py."""

    @pytest.mark.asyncio
    async def test_fetch_article_html_routes_to_playwright(self):
        """Test that fetch_article_html routes to Playwright when strategy is 'playwright'."""
        from backend.app.ingestion.fetcher import fetch_article_html
        from backend.app.ingestion.profiles import SourceProfile

        profile = SourceProfile(
            id="ad_rss",
            fetch_strategy="playwright",
            parser="trafilatura",
        )

        with patch(
            "backend.app.ingestion.fetcher.fetch_with_playwright"
        ) as mock_playwright:
            mock_playwright.return_value = (
                "<html><body>JavaScript rendered content</body></html>"
            )

            html = await fetch_article_html(
                "https://www.ad.nl/article/test",
                profile=profile,
            )

        assert "JavaScript rendered content" in html
        mock_playwright.assert_called_once()
        call_args = mock_playwright.call_args
        assert call_args[0][0] == "https://www.ad.nl/article/test"

    @pytest.mark.asyncio
    async def test_fetch_article_html_playwright_error_raises_article_fetch_error(self):
        """Test that Playwright errors are converted to ArticleFetchError."""
        from backend.app.ingestion.fetcher import ArticleFetchError, fetch_article_html
        from backend.app.ingestion.profiles import SourceProfile

        profile = SourceProfile(
            id="ad_rss",
            fetch_strategy="playwright",
            parser="trafilatura",
        )

        with patch(
            "backend.app.ingestion.fetcher.fetch_with_playwright"
        ) as mock_playwright:
            mock_playwright.side_effect = PlaywrightFetchError("Browser error")

            with pytest.raises(ArticleFetchError) as exc_info:
                await fetch_article_html(
                    "https://www.ad.nl/article/test",
                    profile=profile,
                )

        assert "Playwright failed" in str(exc_info.value)


class TestSourceProfilePlaywrightConfig:
    """Tests for Playwright configuration in source profiles."""

    def test_ad_rss_profile_has_playwright_strategy(self):
        """Test that ad_rss profile is configured with playwright strategy."""
        from backend.app.ingestion.profiles import load_source_profiles

        load_source_profiles.cache_clear()
        profiles = load_source_profiles()

        assert "ad_rss" in profiles
        assert profiles["ad_rss"].fetch_strategy == "playwright"
        assert profiles["ad_rss"].requires_js is True


class TestStealth:
    """playwright-stealth hides the headless browser, but NieuwRechts' Angular app breaks on it."""

    URL = "https://nieuwrechts.nl/113566-twee-somalische-kindsoldaten-uit-zweden-naar-nederland"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("stealth", "applied"), [(True, 1), (False, 0)], ids=["default", "off"])
    async def test_stealth_is_applied_only_when_asked(self, stealth, applied):
        page = _page_on(self.URL, "<html>artikel</html>")

        with _browser_showing(page) as stealth_async:
            html = await fetch_with_playwright(self.URL, stealth=stealth)

        assert html == "<html>artikel</html>"
        assert stealth_async.await_count == applied

    @pytest.mark.asyncio
    async def test_the_fetcher_passes_the_profiles_stealth(self):
        profile = SourceProfile(id="nieuwrechts_rss", fetch_strategy="playwright", stealth=False)

        with patch(
            "backend.app.ingestion.fetcher.fetch_with_playwright", new=AsyncMock(return_value="<html/>")
        ) as fetch:
            await fetch_article_html(self.URL, profile=profile)

        assert fetch.await_args.kwargs["stealth"] is False
