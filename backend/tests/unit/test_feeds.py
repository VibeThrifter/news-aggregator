"""
Unit tests for RSS feed readers and ingest service.

Tests cover parsing, deduplication, error handling, and retry logic
according to Story 1.1 acceptance criteria.
"""

import asyncio
import os
from datetime import datetime
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
        assert metadata["spectrum"] == "center"
        assert metadata["country"] == "NL"

    @pytest.mark.asyncio
    async def test_fetch_success(self):
        """Test successful RSS feed fetching and parsing."""
        # Load sample RSS content
        with open(NOS_SAMPLE_RSS, "r", encoding="utf-8") as f:
            sample_rss = f.read()

        # Mock HTTP response
        mock_response = MagicMock()
        mock_response.content = sample_rss.encode("utf-8")
        mock_response.raise_for_status = MagicMock()

        with patch.object(self.reader._session, "get", return_value=mock_response) as mock_get:
            items = await self.reader.fetch()

            # Verify HTTP call
            mock_get.assert_called_once_with(self.reader.feed_url)
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
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch.object(self.reader._session, "get") as mock_get:
            mock_get.side_effect = httpx.HTTPStatusError(
                "Not Found", request=MagicMock(), response=mock_response
            )

            with pytest.raises(FeedReaderError, match="HTTP error fetching NOS RSS"):
                await self.reader.fetch()

            # Verify retries (at least one call, retry logic tested separately)
            assert mock_get.call_count >= 1

    @pytest.mark.asyncio
    async def test_fetch_network_error(self):
        """Test network error handling."""
        with patch.object(self.reader._session, "get") as mock_get:
            mock_get.side_effect = httpx.RequestError("Connection failed")

            with pytest.raises(FeedReaderError, match="Network error fetching NOS RSS"):
                await self.reader.fetch()

            # Verify retries (at least one call, retry logic tested separately)
            assert mock_get.call_count >= 1

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
        """Test async context manager functionality."""
        with patch.object(self.reader._session, "aclose") as mock_close:
            async with self.reader:
                pass
            mock_close.assert_called_once()


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
        assert metadata["spectrum"] == "center-right"
        assert metadata["country"] == "NL"

    @pytest.mark.asyncio
    async def test_fetch_success(self):
        """Test successful RSS feed fetching and parsing."""
        # Load sample RSS content
        with open(NUNL_SAMPLE_RSS, "r", encoding="utf-8") as f:
            sample_rss = f.read()

        # Mock HTTP response
        mock_response = MagicMock()
        mock_response.content = sample_rss.encode("utf-8")
        mock_response.raise_for_status = MagicMock()

        with patch.object(self.reader._session, "get", return_value=mock_response):
            items = await self.reader.fetch()

            # Verify parsed items
            assert len(items) == 3

            # Check first item details
            first_item = items[0]
            assert "tweede-kamer-debatteert" in first_item.url
            assert "Tweede Kamer" in first_item.title
            assert first_item.source_metadata["name"] == "NU.nl"


class TestIngestService:
    """Test IngestService orchestration."""

    def setup_method(self):
        """Set up test instance with mocked config."""
        with patch('backend.app.services.ingest_service.get_settings') as mock_settings:
            mock_settings.return_value.rss_nos_url = "https://mock-nos.nl/rss"
            mock_settings.return_value.rss_nunl_url = "https://mock-nu.nl/rss"
            self.service = IngestService()

    def test_reader_registration(self):
        """Test that readers are properly registered."""
        assert len(self.service.readers) == 2
        assert "nos_rss" in self.service.readers
        assert "nunl_rss" in self.service.readers

    def test_get_reader_info(self):
        """Test reader info retrieval."""
        info = self.service.get_reader_info()
        assert info["total_count"] == 2
        assert "nos_rss" in info["readers"]
        assert "nunl_rss" in info["readers"]

        nos_info = info["readers"]["nos_rss"]
        assert nos_info["id"] == "nos_rss"
        assert nos_info["url"] == "https://mock-nos.nl/rss"

    @pytest.mark.asyncio
    async def test_poll_feeds_success(self):
        """Test successful polling of all feeds."""
        # Mock successful fetch for all readers
        mock_items = [
            FeedItem(
                guid="test1", url="url1", title="Title 1",
                summary="Summary 1", published_at=datetime.now(),
                source_metadata={"source": "test"}
            )
        ]

        for reader in self.service.readers.values():
            reader.fetch = AsyncMock(return_value=mock_items)
            reader.__aenter__ = AsyncMock(return_value=reader)
            reader.__aexit__ = AsyncMock(return_value=None)

        results = await self.service.poll_feeds(correlation_id="test-123")

        # Verify results
        assert results["success"] is True
        assert results["total_readers"] == 2
        assert results["successful_readers"] == 2
        assert results["failed_readers"] == 0
        assert results["total_items"] == 2  # 1 item per reader
        assert len(results["errors"]) == 0

    @pytest.mark.asyncio
    async def test_poll_feeds_partial_failure(self):
        """Test polling with one reader failing."""
        mock_items = [
            FeedItem(
                guid="test1", url="url1", title="Title 1",
                summary="Summary 1", published_at=datetime.now(),
                source_metadata={"source": "test"}
            )
        ]

        # Mock one success, one failure
        readers = list(self.service.readers.values())
        readers[0].fetch = AsyncMock(return_value=mock_items)
        readers[0].__aenter__ = AsyncMock(return_value=readers[0])
        readers[0].__aexit__ = AsyncMock(return_value=None)

        readers[1].fetch = AsyncMock(side_effect=FeedReaderError("Test error"))
        readers[1].__aenter__ = AsyncMock(return_value=readers[1])
        readers[1].__aexit__ = AsyncMock(return_value=None)

        results = await self.service.poll_feeds()

        # Verify results
        assert results["success"] is False
        assert results["successful_readers"] == 1
        assert results["failed_readers"] == 1
        assert results["total_items"] == 1
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
        assert len(results) == 2
        for reader_id in ["nos_rss", "nunl_rss"]:
            assert reader_id in results
            assert results[reader_id]["status"] == "ok"


@pytest.mark.asyncio
async def test_integration_feeds_with_fixtures():
    """Integration test using actual RSS fixtures."""
    # Test NOS reader with fixture
    nos_reader = NosRssReader("https://mock-nos.nl/rss")

    with open(NOS_SAMPLE_RSS, "r", encoding="utf-8") as f:
        sample_rss = f.read()

    mock_response = MagicMock()
    mock_response.content = sample_rss.encode("utf-8")
    mock_response.raise_for_status = MagicMock()

    with patch.object(nos_reader._session, "get", return_value=mock_response):
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
        assert item.source_metadata["spectrum"] == "center"
        assert item.guid.startswith("nos-")
        assert "nos.nl" in item.url