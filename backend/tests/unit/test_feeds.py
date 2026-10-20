"""
Unit tests for RSS feed readers and ingest service.

Tests cover parsing, deduplication, error handling, and retry logic
according to Story 1.1 acceptance criteria.
"""

import asyncio
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

import pytest
import httpx

import sys
import os

# Add backend directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../..'))

from backend.app.feeds.base import FeedReader, FeedItem, FeedReaderError
from backend.app.feeds.nos import NosRssReader
from backend.app.feeds.nunl import NuRssReader
from backend.app.services.ingest_service import IngestService


# Test data paths
FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "rss"
NOS_SAMPLE_RSS = FIXTURES_DIR / "nos_sample.xml"
NUNL_SAMPLE_RSS = FIXTURES_DIR / "nunl_sample.xml"


class TestFeedItem:
    """Test FeedItem data class validation."""

    def test_valid_feed_item(self):
        """Test creating a valid FeedItem."""
        item = FeedItem(
            guid="test-guid",
            url="https://example.com/article",
            title="Test Article",
            summary="Test summary",
            published_at=datetime.now(),
            source_metadata={"source": "test"}
        )
        assert item.guid == "test-guid"
        assert item.url == "https://example.com/article"
        assert item.title == "Test Article"

    def test_feed_item_missing_guid(self):
        """Test FeedItem validation with missing guid."""
        with pytest.raises(ValueError, match="guid is required"):
            FeedItem(
                guid="",
                url="https://example.com/article",
                title="Test Article",
                summary=None,
                published_at=datetime.now(),
                source_metadata={}
            )

    def test_feed_item_missing_url(self):
        """Test FeedItem validation with missing URL."""
        with pytest.raises(ValueError, match="url is required"):
            FeedItem(
                guid="test-guid",
                url="",
                title="Test Article",
                summary=None,
                published_at=datetime.now(),
                source_metadata={}
            )

    def test_feed_item_missing_title(self):
        """Test FeedItem validation with missing title."""
        with pytest.raises(ValueError, match="title is required"):
            FeedItem(
                guid="test-guid",
                url="https://example.com/article",
                title="",
                summary=None,
                published_at=datetime.now(),
                source_metadata={}
            )


class TestNosRssReader:
    """Test NOS RSS reader implementation."""

    def setup_method(self):
        """Set up test instance."""
        self.reader = NosRssReader("https://feeds.nos.nl/nosnieuwsalgemeen")

    def test_reader_properties(self):
        """Test reader ID and source metadata."""
        assert self.reader.id == "nos_rss"
        metadata = self.reader.source_metadata
        assert metadata["name"] == "NOS"
        assert metadata["spectrum"] == 4  # 0=far-left, 10=far-right
        assert metadata["country"] == "NL"

    @pytest.mark.asyncio
    async def test_fetch_success(self):
        """Test successful RSS feed fetching and parsing."""
        from contextlib import asynccontextmanager

        # Load sample RSS content
        with open(NOS_SAMPLE_RSS, "r", encoding="utf-8") as f:
            sample_rss = f.read()

        # Mock HTTP response
        mock_response = MagicMock()
        mock_response.content = sample_rss.encode("utf-8")
        mock_response.raise_for_status = MagicMock()

        # Mock the HTTP client context manager
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        @asynccontextmanager
        async def mock_http_client(*args, **kwargs):
            yield mock_client

        with patch('backend.app.feeds.nos.http_client', mock_http_client):
            items = await self.reader.fetch()

            # Verify HTTP call
            mock_client.get.assert_called_once_with(self.reader.feed_url)
            mock_response.raise_for_status.assert_called_once()

            # Verify parsed items
            assert len(items) == 3

            # Check first item details
            first_item = items[0]
            assert first_item.guid == "nos-2525901"
            assert first_item.title == "Kabinet presenteert nieuwe klimaatmaatregelen"
            assert "nos.nl" in first_item.url
            assert first_item.summary is not None
            assert first_item.published_at is not None
            assert first_item.source_metadata["name"] == "NOS"

    @pytest.mark.asyncio
    async def test_fetch_http_error(self):
        """Test HTTP error handling with retry."""
        from contextlib import asynccontextmanager

        mock_response = MagicMock()
        mock_response.status_code = 404

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.HTTPStatusError(
            "Not Found", request=MagicMock(), response=mock_response
        ))

        @asynccontextmanager
        async def mock_http_client(*args, **kwargs):
            yield mock_client

        with patch('backend.app.feeds.nos.http_client', mock_http_client):
            with pytest.raises(FeedReaderError, match="HTTP error fetching NOS RSS"):
                await self.reader.fetch()

            # Verify retries (at least one call, retry logic tested separately)
            assert mock_client.get.call_count >= 1

    @pytest.mark.asyncio
    async def test_fetch_network_error(self):
        """Test network error handling."""
        from contextlib import asynccontextmanager

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.RequestError("Connection failed"))

        @asynccontextmanager
        async def mock_http_client(*args, **kwargs):
            yield mock_client

        with patch('backend.app.feeds.nos.http_client', mock_http_client):
            with pytest.raises(FeedReaderError, match="Network error fetching NOS RSS"):
                await self.reader.fetch()

            # Verify retries (at least one call, retry logic tested separately)
            assert mock_client.get.call_count >= 1

    def test_filter_duplicates(self):
        """Test duplicate filtering by GUID and URL."""
        items = [
            FeedItem(
                guid="guid1", url="url1", title="Title 1",
                summary=None, published_at=datetime.now(), source_metadata={}
            ),
            FeedItem(
                guid="guid1", url="url2", title="Title 2",  # Duplicate GUID
                summary=None, published_at=datetime.now(), source_metadata={}
            ),
            FeedItem(
                guid="guid3", url="url1", title="Title 3",  # Duplicate URL
                summary=None, published_at=datetime.now(), source_metadata={}
            ),
            FeedItem(
                guid="guid4", url="url4", title="Title 4",  # Unique
                summary=None, published_at=datetime.now(), source_metadata={}
            ),
        ]

        filtered = self.reader._filter_duplicates(items)
        assert len(filtered) == 2  # Only first and last items should remain
        assert filtered[0].guid == "guid1"
        assert filtered[1].guid == "guid4"

    def test_clean_html(self):
        """Test HTML cleaning utility."""
        html_text = "<p>This is <strong>bold</strong> text with <a href='#'>links</a>.</p>"
        clean_text = self.reader._clean_html(html_text)
        assert clean_text == "This is bold text with links."

        # Test with None/empty
        assert self.reader._clean_html(None) == ""
        assert self.reader._clean_html("") == ""

    @pytest.mark.asyncio
    async def test_context_manager(self):
        """Test that http_client context manager works correctly."""
        from backend.app.feeds.base import http_client

        # Verify the context manager creates and closes clients properly
        async with http_client() as client:
            assert client is not None
            assert isinstance(client, httpx.AsyncClient)


class TestNuRssReader:
    """Test NU.nl RSS reader implementation."""

    def setup_method(self):
        """Set up test instance."""
        self.reader = NuRssReader("https://www.nu.nl/rss/Algemeen")

    def test_reader_properties(self):
        """Test reader ID and source metadata."""
        assert self.reader.id == "nunl_rss"
        metadata = self.reader.source_metadata
        assert metadata["name"] == "NU.nl"
        assert metadata["spectrum"] == 6  # 0=far-left, 10=far-right
        assert metadata["country"] == "NL"

    @pytest.mark.asyncio
    async def test_fetch_success(self):
        """Test successful RSS feed fetching and parsing."""
        from contextlib import asynccontextmanager

        # Load sample RSS content
        with open(NUNL_SAMPLE_RSS, "r", encoding="utf-8") as f:
            sample_rss = f.read()

        # Mock HTTP response
        mock_response = MagicMock()
        mock_response.content = sample_rss.encode("utf-8")
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        @asynccontextmanager
        async def mock_http_client(*args, **kwargs):
            yield mock_client

        with patch('backend.app.feeds.nunl.http_client', mock_http_client):
            items = await self.reader.fetch()

            # Verify parsed items
            assert len(items) == 3

            # Check first item details
            first_item = items[0]
            assert "tweede-kamer-debatteert" in first_item.url
            assert "Tweede Kamer" in first_item.title
            assert first_item.source_metadata["name"] == "NU.nl"


YOUTUBE_FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
 <title>Een blik op de NOS</title>
 <entry>
  <id>yt:video:MRWPnZVOtCc</id>
  <yt:videoId>MRWPnZVOtCc</yt:videoId>
  <yt:channelId>UCpsU4OfNLGVyTmKs4Ir28LQ</yt:channelId>
  <title>"vliegramp" = 9/11-achtige terreuraanslag</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=MRWPnZVOtCc"/>
  <published>2026-10-02T19:18:49+00:00</published>
  <media:group>
   <media:title>"vliegramp" = 9/11-achtige terreuraanslag</media:title>
   <media:thumbnail url="https://i2.ytimg.com/vi/MRWPnZVOtCc/hqdefault.jpg" width="480" height="360"/>
   <media:description>Bij monde van Winfried Baijens zegt de NOS dat de piloot een "vliegramp" heeft voorkomen.</media:description>
  </media:group>
 </entry>
</feed>
"""


INDEPEN_FEED = b"""<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
    xmlns:content="http://purl.org/rss/1.0/modules/content/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
    <title>INDEPEN</title>
    <link>https://indepen.eu</link>
    <item>
        <title>Migratie verantwoordelijk voor 60 procent van de woningvraag</title>
        <link>https://indepen.eu/migratie-verantwoordelijk-voor-60-procent-van-de-woningvraag/</link>
        <dc:creator><![CDATA[Redactie Indepen]]></dc:creator>
        <pubDate>Mon, 19 Oct 2026 06:16:53 +0000</pubDate>
        <category><![CDATA[Politiek]]></category>
        <category><![CDATA[Uitgelicht]]></category>
        <guid isPermaLink="false">https://indepen.eu/?p=73774</guid>
        <description><![CDATA[Deze kop staat boven een artikel van Binnenlands Bestuur en leidde recent tot nogal wat ophef. Eindelijk hebben [&#8230;]]]></description>
        <content:encoded><![CDATA[<p><em>Deze kop staat boven een artikel van Binnenlands Bestuur en leidde recent tot nogal wat ophef.</em></p>
<h2>Migratieonderzoek van het Economisch Instituut voor de Bouw</h2>
<p>Dat blijkt uit <a href="https://www.eib.nl/x.pdf" rel="noopener" target="_blank">onderzoek</a> van het EIB.</p>
<ul>
<li>arbeidsmigranten</li>
<li>asielmigranten</li>
</ul>
<p>Minister Boekholt-O&#8217;Sullivan reageerde.</p>
]]></content:encoded>
    </item>
    <item>
        <title>Een bericht zonder volledige tekst</title>
        <link>https://indepen.eu/een-bericht-zonder-volledige-tekst/</link>
        <pubDate>Mon, 19 Oct 2026 08:00:00 +0000</pubDate>
        <guid isPermaLink="false">https://indepen.eu/?p=73775</guid>
        <description><![CDATA[Alleen het begin [&#8230;]]]></description>
    </item>
</channel>
</rss>
"""


class TestIndepenReader:
    """INDEPEN: the WordPress feed holds the full text; the page (with comments) is never fetched."""

    @staticmethod
    async def fetch_items():
        from contextlib import asynccontextmanager

        from backend.app.feeds.indepen import IndepenRssReader

        response = MagicMock()
        response.content = INDEPEN_FEED
        response.raise_for_status = MagicMock()
        client = AsyncMock()
        client.get = AsyncMock(return_value=response)

        @asynccontextmanager
        async def mock_http_client(*args, **kwargs):
            yield client

        reader = IndepenRssReader("https://indepen.eu/feed/")
        with patch("backend.app.feeds.indepen.http_client", mock_http_client):
            items = await reader.fetch()
        client.get.assert_called_once_with("https://indepen.eu/feed/")
        assert reader.id == "indepen_rss"
        return items

    @pytest.mark.asyncio
    async def test_the_text_comes_from_the_feed_a_line_per_paragraph(self):
        item, _ = await self.fetch_items()

        assert item.guid == "https://indepen.eu/?p=73774"
        assert item.url == "https://indepen.eu/migratie-verantwoordelijk-voor-60-procent-van-de-woningvraag/"
        assert item.title == "Migratie verantwoordelijk voor 60 procent van de woningvraag"
        assert item.summary == (
            "Deze kop staat boven een artikel van Binnenlands Bestuur en leidde recent tot nogal wat "
            "ophef. Eindelijk hebben…"
        )
        assert item.published_at == datetime(2026, 10, 19, 6, 16, 53, tzinfo=timezone.utc)
        assert item.image_url is None
        assert item.source_metadata["full_text_from_feed"] == (
            "Deze kop staat boven een artikel van Binnenlands Bestuur en leidde recent tot nogal wat ophef.\n"
            "Migratieonderzoek van het Economisch Instituut voor de Bouw\n"
            "Dat blijkt uit onderzoek van het EIB.\n"
            "arbeidsmigranten\n"
            "asielmigranten\n"
            "Minister Boekholt-O’Sullivan reageerde."
        )
        assert item.source_metadata["name"] == "INDEPEN"
        assert item.source_metadata["spectrum"] == "alternative"
        assert item.source_metadata["author"] == "Redactie Indepen"
        assert item.source_metadata["categories"] == ["Politiek", "Uitgelicht"]

    @pytest.mark.asyncio
    async def test_without_full_text_the_excerpt_is_the_text(self):
        _, item = await self.fetch_items()

        # Never empty: an empty text would send the ingest to the page, comments and all
        assert item.source_metadata["full_text_from_feed"] == "Alleen het begin…"


class TestEenBlikOpDeNosReader:
    """Een Blik op de NOS comes from its YouTube channel since X answers 403 (2025-12)."""

    @pytest.mark.asyncio
    async def test_videos_become_items_with_the_description_as_text(self):
        from contextlib import asynccontextmanager

        from backend.app.feeds.eenblikopdenos import DEFAULT_FEED_URL, EenBlikOpDeNosReader

        response = MagicMock()
        response.content = YOUTUBE_FEED
        response.raise_for_status = MagicMock()
        client = AsyncMock()
        client.get = AsyncMock(return_value=response)

        @asynccontextmanager
        async def mock_http_client(*args, **kwargs):
            yield client

        reader = EenBlikOpDeNosReader(DEFAULT_FEED_URL)
        with patch("backend.app.feeds.eenblikopdenos.http_client", mock_http_client):
            items = await reader.fetch()

        client.get.assert_called_once_with(DEFAULT_FEED_URL)
        assert reader.id == "eenblikopdenos_rss"
        [item] = items
        assert item.guid == "youtube-MRWPnZVOtCc"
        assert item.url == "https://www.youtube.com/watch?v=MRWPnZVOtCc"
        assert item.title == '"vliegramp" = 9/11-achtige terreuraanslag'
        assert item.published_at == datetime(2026, 10, 2, 19, 18, 49, tzinfo=timezone.utc)
        assert item.image_url == "https://i2.ytimg.com/vi/MRWPnZVOtCc/hqdefault.jpg"
        assert item.source_metadata["name"] == "Een Blik op de NOS"
        text = item.source_metadata["full_text_from_feed"]
        assert text.startswith('"vliegramp"') and "Winfried Baijens" in text


class TestIngestService:
    """Test IngestService orchestration."""

    def setup_method(self):
        """Set up test instance with mocked config."""
        with patch('backend.app.services.ingest_service.get_settings') as mock_settings:
            mock_settings.return_value.rss_nos_url = "https://mock-nos.nl/rss"
            mock_settings.return_value.rss_nunl_url = "https://mock-nu.nl/rss"
            mock_settings.return_value.rss_ad_url = "https://mock-ad.nl/rss"
            mock_settings.return_value.rss_rtl_url = "https://mock-rtl.nl/rss"
            mock_settings.return_value.rss_telegraaf_url = "https://mock-telegraaf.nl/rss"
            mock_settings.return_value.rss_volkskrant_url = "https://mock-volkskrant.nl/rss"
            mock_settings.return_value.rss_parool_url = "https://mock-parool.nl/rss"
            mock_settings.return_value.rss_anderekrant_url = "https://mock-anderekrant.nl/rss"
            mock_settings.return_value.rss_trouw_url = "https://mock-trouw.nl/rss"
            mock_settings.return_value.rss_geenstijl_url = "https://mock-geenstijl.nl/atom"
            mock_settings.return_value.rss_ninefornews_url = "https://mock-ninefornews.nl/feed"
            mock_settings.return_value.rss_nieuwrechts_url = "https://mock-nieuwrechts.nl/rss"
            mock_settings.return_value.rss_indepen_url = "https://mock-indepen.eu/feed/"
            mock_settings.return_value.rss_eenblikopdenos_url = "https://mock-xcancel.com/eenblikopdenos/rss"
            self.service = IngestService()

    def test_reader_registration(self):
        """Test that readers are properly registered."""
        assert len(self.service.readers) == 14
        assert "nos_rss" in self.service.readers
        assert "nunl_rss" in self.service.readers
        assert "ad_rss" in self.service.readers
        assert "rtl_rss" in self.service.readers
        assert "telegraaf_rss" in self.service.readers
        assert "volkskrant_rss" in self.service.readers
        assert "parool_rss" in self.service.readers
        assert "anderekrant_rss" in self.service.readers
        assert "trouw_rss" in self.service.readers
        assert "geenstijl_atom" in self.service.readers
        assert "ninefornews_rss" in self.service.readers
        assert "nieuwrechts_rss" in self.service.readers
        assert "indepen_rss" in self.service.readers
        assert "eenblikopdenos_rss" in self.service.readers

    def test_get_reader_info(self):
        """Test reader info retrieval."""
        info = self.service.get_reader_info()
        assert info["total_count"] == 14
        assert "nos_rss" in info["readers"]
        assert "nunl_rss" in info["readers"]
        assert "ad_rss" in info["readers"]
        assert "rtl_rss" in info["readers"]
        assert "telegraaf_rss" in info["readers"]
        assert "volkskrant_rss" in info["readers"]
        assert "parool_rss" in info["readers"]
        assert "anderekrant_rss" in info["readers"]
        assert "trouw_rss" in info["readers"]
        assert "geenstijl_atom" in info["readers"]
        assert "ninefornews_rss" in info["readers"]
        assert "nieuwrechts_rss" in info["readers"]
        assert "indepen_rss" in info["readers"]
        assert "eenblikopdenos_rss" in info["readers"]

        nos_info = info["readers"]["nos_rss"]
        assert nos_info["id"] == "nos_rss"
        # Check that url key exists (actual feed URL)
        assert "url" in nos_info
        assert nos_info["url"] == "https://feeds.nos.nl/nosnieuwsalgemeen"

    @pytest.mark.asyncio
    async def test_poll_feeds_success(self):
        """Test successful polling of all feeds."""
        # Mock successful fetch for all readers with valid URLs
        mock_items = [
            FeedItem(
                guid="test1", url="https://example.com/article1", title="Title 1",
                summary="Summary 1", published_at=datetime.now(),
                source_metadata={"source": "test"}
            )
        ]

        for reader in self.service.readers.values():
            reader.fetch = AsyncMock(return_value=mock_items)
            reader.__aenter__ = AsyncMock(return_value=reader)
            reader.__aexit__ = AsyncMock(return_value=None)

        # Mock article processing to avoid actual HTTP calls
        async def mock_process(reader_id, items, profile, **kwargs):
            return {"ingested": len(items), "duplicates": 0, "fetch_failures": 0}

        self.service.process_feed_items = AsyncMock(side_effect=mock_process)

        # Mock enabled sources to return all reader IDs
        all_reader_ids = set(self.service.readers.keys())
        with patch('backend.app.services.ingest_service._get_enabled_source_ids', AsyncMock(return_value=all_reader_ids)):
            results = await self.service.poll_feeds(correlation_id="test-123")

        # Verify results
        assert results["success"] is True
        assert results["total_readers"] == 14
        assert results["successful_readers"] == 14
        assert results["failed_readers"] == 0
        assert results["total_items"] == 14  # 1 item per reader
        assert len(results["errors"]) == 0

    @pytest.mark.asyncio
    async def test_poll_feeds_partial_failure(self):
        """Test polling with one reader failing."""
        mock_items = [
            FeedItem(
                guid="test1", url="https://example.com/article1", title="Title 1",
                summary="Summary 1", published_at=datetime.now(),
                source_metadata={"source": "test"}
            )
        ]

        # Mock article processing to avoid actual HTTP calls
        async def mock_process(reader_id, items, profile, **kwargs):
            return {"ingested": len(items), "duplicates": 0, "fetch_failures": 0}

        self.service.process_feed_items = AsyncMock(side_effect=mock_process)

        # Mock readers: first one fails, rest succeed
        readers = list(self.service.readers.values())
        readers[0].fetch = AsyncMock(side_effect=FeedReaderError("Test error"))
        readers[0].__aenter__ = AsyncMock(return_value=readers[0])
        readers[0].__aexit__ = AsyncMock(return_value=None)

        for reader in readers[1:]:
            reader.fetch = AsyncMock(return_value=mock_items)
            reader.__aenter__ = AsyncMock(return_value=reader)
            reader.__aexit__ = AsyncMock(return_value=None)

        # Mock enabled sources to return all reader IDs
        all_reader_ids = set(self.service.readers.keys())
        with patch('backend.app.services.ingest_service._get_enabled_source_ids', AsyncMock(return_value=all_reader_ids)):
            results = await self.service.poll_feeds()

        # Verify results
        assert results["success"] is False
        assert results["successful_readers"] == 13  # 13 out of 14 succeed
        assert results["failed_readers"] == 1
        assert results["total_items"] == 13
        assert len(results["errors"]) == 1
        assert "Test error" in results["errors"][0]["error"]

    def test_serialize_item(self):
        """Test FeedItem serialization."""
        item = FeedItem(
            guid="test-guid",
            url="https://example.com",
            title="Test Title",
            summary="Test Summary",
            published_at=datetime(2025, 9, 28, 12, 0, 0),
            source_metadata={"source": "test", "spectrum": "center"}
        )

        serialized = self.service._serialize_item(item)

        assert serialized["guid"] == "test-guid"
        assert serialized["url"] == "https://example.com"
        assert serialized["title"] == "Test Title"
        assert serialized["summary"] == "Test Summary"
        assert serialized["published_at"] == "2025-09-28T12:00:00"
        assert serialized["source_metadata"]["spectrum"] == "center"

    @pytest.mark.asyncio
    async def test_test_readers(self):
        """Test reader connectivity testing."""
        # Mock readers for testing
        for reader in self.service.readers.values():
            reader.__aenter__ = AsyncMock(return_value=reader)
            reader.__aexit__ = AsyncMock(return_value=None)

        results = await self.service.test_readers()

        # Verify all readers tested
        assert len(results) == 14
        for reader_id in ["nos_rss", "nunl_rss", "ad_rss", "rtl_rss", "telegraaf_rss", "volkskrant_rss", "parool_rss", "anderekrant_rss", "trouw_rss", "geenstijl_atom", "ninefornews_rss", "nieuwrechts_rss", "indepen_rss", "eenblikopdenos_rss"]:
            assert reader_id in results
            assert results[reader_id]["status"] == "ok"


@pytest.mark.asyncio
async def test_integration_feeds_with_fixtures():
    """Integration test using actual RSS fixtures."""
    from contextlib import asynccontextmanager

    # Test NOS reader with fixture
    nos_reader = NosRssReader("https://mock-nos.nl/rss")

    with open(NOS_SAMPLE_RSS, "r", encoding="utf-8") as f:
        sample_rss = f.read()

    mock_response = MagicMock()
    mock_response.content = sample_rss.encode("utf-8")
    mock_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    @asynccontextmanager
    async def mock_http_client(*args, **kwargs):
        yield mock_client

    with patch('backend.app.feeds.nos.http_client', mock_http_client):
        items = await nos_reader.fetch()

    assert len(items) == 3

    # Verify we have the expected articles
    titles = [item.title for item in items]
    assert "Kabinet presenteert nieuwe klimaatmaatregelen" in titles
    assert "Europese Unie stelt nieuwe sancties in tegen Rusland" in titles
    assert "Inflatie daalt naar laagste niveau in twee jaar" in titles

    # Verify metadata
    for item in items:
        assert item.source_metadata["name"] == "NOS"
        assert item.source_metadata["spectrum"] == 4  # 0=far-left, 10=far-right
        assert item.guid.startswith("nos-")
        assert "nos.nl" in item.url