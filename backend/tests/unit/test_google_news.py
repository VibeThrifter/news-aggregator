"""Unit tests for GoogleNewsReader."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.feeds.google_news import (
    GoogleNewsArticle,
    GoogleNewsReader,
    GoogleNewsReaderError,
    fetch_international_articles,
)
from backend.app.services.country_detector import Country, GoogleNewsParams

# Sample RSS feed response for testing
SAMPLE_RSS_CONTENT = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Israel Netanyahu - Google News</title>
    <link>https://news.google.com</link>
    <item>
      <title>Netanyahu announces new policy - Times of Israel</title>
      <link>https://news.google.com/rss/articles/CBMiX2h0dHBz...</link>
      <pubDate>Sat, 28 Dec 2024 10:00:00 GMT</pubDate>
      <description>The Prime Minister announced...</description>
      <source url="https://www.timesofisrael.com">Times of Israel</source>
    </item>
    <item>
      <title>Israel updates security measures - Haaretz</title>
      <link>https://news.google.com/rss/articles/CBMiY2h0dHBz...</link>
      <pubDate>Sat, 28 Dec 2024 09:00:00 GMT</pubDate>
      <description>Security officials report...</description>
      <source url="https://www.haaretz.com">Haaretz</source>
    </item>
  </channel>
</rss>
"""


@pytest.fixture
def israel_country() -> Country:
    """Create a test Country object for Israel."""
    return Country(
        key="israel",
        name="Israel",
        iso_code="IL",
        google_news_primary=GoogleNewsParams(gl="IL", hl="en", ceid="IL:en"),
        google_news_native=GoogleNewsParams(gl="IL", hl="iw", ceid="IL:iw"),
    )


@pytest.fixture
def russia_country() -> Country:
    """Create a test Country object for Russia."""
    return Country(
        key="russia",
        name="Russia",
        iso_code="RU",
        google_news_primary=GoogleNewsParams(gl="RU", hl="en", ceid="RU:en"),
        google_news_native=GoogleNewsParams(gl="RU", hl="ru", ceid="RU:ru"),
    )


class TestGoogleNewsReader:
    """Tests for GoogleNewsReader class."""

    def test_init_with_primary_language(self, israel_country):
        """Test initialization with primary (English) language."""
        reader = GoogleNewsReader(israel_country)

        assert reader.country_code == "IL"
        assert reader.params.hl == "en"
        assert reader.params.gl == "IL"

    def test_init_with_native_language(self, israel_country):
        """Test initialization with native language."""
        reader = GoogleNewsReader(israel_country, use_native_lang=True)

        assert reader.country_code == "IL"
        assert reader.params.hl == "iw"  # Hebrew

    def test_init_without_native_fallback(self):
        """Test that countries without native config use primary."""
        country = Country(
            key="test",
            name="Test",
            iso_code="XX",
            google_news_primary=GoogleNewsParams(gl="XX", hl="en", ceid="XX:en"),
            google_news_native=None,
        )
        reader = GoogleNewsReader(country, use_native_lang=True)

        # Should fall back to primary
        assert reader.params.hl == "en"

    def test_build_search_url(self, israel_country):
        """Test that search URL is correctly built."""
        reader = GoogleNewsReader(israel_country)

        url = reader._build_search_url("Netanyahu government")

        assert "https://news.google.com/rss/search?" in url
        assert "q=Netanyahu+government" in url or "q=Netanyahu%20government" in url
        assert "hl=en" in url
        assert "gl=IL" in url
        assert "ceid=IL%3Aen" in url or "ceid=IL:en" in url

    @pytest.mark.asyncio
    async def test_fetch_by_keywords_success(self, israel_country):
        """Test successful fetch of articles."""
        reader = GoogleNewsReader(israel_country)

        # Mock HTTP response
        mock_response = MagicMock()
        mock_response.content = SAMPLE_RSS_CONTENT
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            # Mock URL decoder to return Google URL as-is
            with patch.object(reader, "_decode_url_sync", side_effect=lambda x: x):
                articles = await reader.fetch_by_keywords(["Netanyahu"])

        assert len(articles) == 2
        assert articles[0].source_name == "Times of Israel"
        assert articles[1].source_name == "Haaretz"
        assert all(a.source_country == "IL" for a in articles)
        assert all(a.is_international for a in articles)

    @pytest.mark.asyncio
    async def test_fetch_by_keywords_empty(self, israel_country):
        """Test fetch with empty keywords returns empty list."""
        reader = GoogleNewsReader(israel_country)

        articles = await reader.fetch_by_keywords([])

        assert articles == []

    @pytest.mark.asyncio
    async def test_fetch_by_keywords_max_results(self, israel_country):
        """Test that max_results limits returned articles."""
        reader = GoogleNewsReader(israel_country)

        mock_response = MagicMock()
        mock_response.content = SAMPLE_RSS_CONTENT  # Has 2 articles
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch.object(reader, "_decode_url_sync", side_effect=lambda x: x):
                articles = await reader.fetch_by_keywords(["Netanyahu"], max_results=1)

        assert len(articles) == 1

    @pytest.mark.asyncio
    async def test_fetch_by_keywords_network_error(self, israel_country):
        """Test that network errors are properly handled."""
        reader = GoogleNewsReader(israel_country)

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection failed")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(GoogleNewsReaderError):
                await reader.fetch_by_keywords(["Netanyahu"])

    def test_extract_source_name_from_source(self, israel_country):
        """Test source name extraction from source attribute."""
        reader = GoogleNewsReader(israel_country)

        entry = MagicMock()
        entry.source = MagicMock(title="Times of Israel")
        entry.title = "Article title - Times of Israel"

        source = reader._extract_source_name(entry)
        assert source == "Times of Israel"

    def test_extract_source_name_from_title(self, israel_country):
        """Test source name extraction from title fallback."""
        reader = GoogleNewsReader(israel_country)

        entry = MagicMock(spec=[])
        entry.title = "Breaking news headline - Haaretz"
        # No source attribute

        source = reader._extract_source_name(entry)
        assert source == "Haaretz"

    def test_extract_source_name_unknown(self, israel_country):
        """Test source name fallback to Unknown."""
        reader = GoogleNewsReader(israel_country)

        entry = MagicMock(spec=[])
        entry.title = "No source in title"
        # No source attribute, no dash in title

        source = reader._extract_source_name(entry)
        assert source == "Unknown"

    def test_clean_html(self, israel_country):
        """Test HTML tag removal."""
        reader = GoogleNewsReader(israel_country)

        html = "<p>This is <b>bold</b> and <a href='#'>linked</a> text.</p>"
        cleaned = reader._clean_html(html)

        assert cleaned == "This is bold and linked text."
        assert "<" not in cleaned
        assert ">" not in cleaned

    def test_parse_date_from_published(self, israel_country):
        """Test date parsing from published field."""
        reader = GoogleNewsReader(israel_country)

        entry = MagicMock()
        entry.published = "Sat, 28 Dec 2024 10:00:00 GMT"

        parsed = reader._parse_date(entry)

        assert isinstance(parsed, datetime)
        assert parsed.day == 28
        assert parsed.month == 12
        assert parsed.year == 2024


class TestURLDecoding:
    """Tests for Google News URL decoding."""

    def test_decode_url_sync_success(self, israel_country):
        """Test successful URL decoding with mock."""
        reader = GoogleNewsReader(israel_country)

        with patch("googlenewsdecoder.gnewsdecoder") as mock_decoder:
            mock_decoder.return_value = {
                "status": True,
                "decoded_url": "https://www.timesofisrael.com/article/123",
            }

            result = reader._decode_url_sync(
                "https://news.google.com/rss/articles/CBMiX2h0dHBz..."
            )

        assert result == "https://www.timesofisrael.com/article/123"

    def test_decode_url_sync_failure_returns_original(self, israel_country):
        """Test that decoding failure returns original URL."""
        reader = GoogleNewsReader(israel_country)

        with patch("googlenewsdecoder.gnewsdecoder") as mock_decoder:
            mock_decoder.return_value = {
                "status": False,
                "message": "Decoding failed",
            }

            result = reader._decode_url_sync(
                "https://news.google.com/rss/articles/CBMiX2h0dHBz..."
            )

        # Should return original URL when decoding fails
        assert result == "https://news.google.com/rss/articles/CBMiX2h0dHBz..."

    @pytest.mark.asyncio
    async def test_decode_google_url_non_article_url(self, israel_country):
        """Test that non-article URLs skip decoding and return as-is."""
        reader = GoogleNewsReader(israel_country)

        # Non-article URL (no /articles/ in path) should be returned unchanged
        result = await reader._decode_google_url("https://example.com/article")

        assert result == "https://example.com/article"

    @pytest.mark.asyncio
    async def test_decode_google_url_fallback(self, israel_country):
        """Test that decoding failure returns original URL."""
        reader = GoogleNewsReader(israel_country)

        # Mock decoder to fail
        with patch.object(
            reader, "_decode_url_sync", side_effect=Exception("Decode failed")
        ):
            result = await reader._decode_google_url(
                "https://news.google.com/rss/articles/CBMiX2h0dHBz..."
            )

        # Should return original URL
        assert result == "https://news.google.com/rss/articles/CBMiX2h0dHBz..."


class TestFetchInternationalArticles:
    """Tests for convenience function fetch_international_articles."""

    @pytest.mark.asyncio
    async def test_fetch_multiple_countries(self, israel_country, russia_country):
        """Test fetching from multiple countries."""
        mock_response = MagicMock()
        mock_response.content = SAMPLE_RSS_CONTENT
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch(
                "backend.app.feeds.google_news.GoogleNewsReader._decode_url_sync",
                side_effect=lambda x: x,
            ):
                results = await fetch_international_articles(
                    keywords=["conflict"],
                    countries=[israel_country, russia_country],
                    max_per_country=5,
                    rate_limit_delay=0,  # No delay for tests
                )

        assert "IL" in results
        assert "RU" in results
        assert len(results["IL"]) == 2
        assert len(results["RU"]) == 2

    @pytest.mark.asyncio
    async def test_fetch_handles_country_failure(self, israel_country, russia_country):
        """Test that one country failure doesn't affect others."""
        call_count = 0

        async def mock_get(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call (Israel) succeeds
                response = MagicMock()
                response.content = SAMPLE_RSS_CONTENT
                response.raise_for_status = MagicMock()
                return response
            else:
                # Second call (Russia) fails
                raise httpx.ConnectError("Network error")

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = mock_get
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch(
                "backend.app.feeds.google_news.GoogleNewsReader._decode_url_sync",
                side_effect=lambda x: x,
            ):
                results = await fetch_international_articles(
                    keywords=["news"],
                    countries=[israel_country, russia_country],
                    rate_limit_delay=0,
                )

        # Israel should have articles, Russia should have empty list
        assert len(results["IL"]) == 2
        assert results["RU"] == []


class TestGoogleNewsArticleDataclass:
    """Tests for GoogleNewsArticle dataclass."""

    def test_article_creation(self):
        """Test creating a GoogleNewsArticle."""
        article = GoogleNewsArticle(
            url="https://example.com/article",
            title="Test Article",
            published_at=datetime(2024, 12, 28, 10, 0, 0),
            source_name="Example News",
            source_country="IL",
            summary="This is a test article.",
            is_international=True,
        )

        assert article.url == "https://example.com/article"
        assert article.title == "Test Article"
        assert article.source_country == "IL"
        assert article.is_international is True

    def test_article_default_values(self):
        """Test GoogleNewsArticle default values."""
        article = GoogleNewsArticle(
            url="https://example.com/article",
            title="Test Article",
            published_at=datetime.now(),
            source_name="Example News",
            source_country="US",
        )

        assert article.summary is None
        assert article.is_international is True  # Default
        assert article.google_url is None
