"""Unit tests for Playwright-based article fetching."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.ingestion.playwright_fetch import (
    PlaywrightBrowserPool,
    PlaywrightFetchError,
    fetch_with_playwright,
)


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
