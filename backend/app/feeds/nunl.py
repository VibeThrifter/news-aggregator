"""
NU.nl RSS feed reader implementation.

Fetches and normalizes RSS feeds from NU.nl.
"""

import re
from datetime import datetime
from typing import List, Dict, Any
from dateutil import parser
import feedparser
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .base import FeedReader, FeedItem, FeedReaderError


class NuRssReader(FeedReader):
    """RSS reader for NU.nl news feeds."""

    def __init__(self, feed_url: str):
        """Initialize NU.nl RSS reader."""
        super().__init__(feed_url)
        self._session = httpx.AsyncClient(
            timeout=30.0,
            headers={
                "User-Agent": "News-Aggregator/1.0 (+https://github.com/yourusername/news-aggregator)"
            }
        )

    @property
    def id(self) -> str:
        """Return unique identifier for NU.nl feed reader."""
        return "nunl_rss"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about NU.nl as a news source."""
        return {
            "name": "NU.nl",
            "full_name": "NU.nl",
            "spectrum": "center-right",  # NU.nl is considered center-right commercial
            "country": "NL",
            "language": "nl",
            "media_type": "commercial"
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def fetch(self) -> List[FeedItem]:
        """
        Fetch and parse NU.nl RSS feed entries.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching NU.nl RSS feed", feed_url=self.feed_url)

            # Fetch RSS content with HTTPX
            response = await self._session.get(self.feed_url)
            response.raise_for_status()

            # Parse with feedparser
            feed = feedparser.parse(response.content)

            if feed.bozo:
                self.logger.warning("RSS feed has parsing issues",
                                  bozo_exception=str(feed.bozo_exception))

            # Convert entries to normalized FeedItems
            items = []
            for entry in feed.entries:
                try:
                    item = self._parse_entry(entry, feed)
                    items.append(item)
                except Exception as e:
                    self.logger.warning("Failed to parse feed entry",
                                      entry_id=getattr(entry, "id", "unknown"),
                                      error=str(e))
                    continue

            # Filter duplicates and return
            unique_items = self._filter_duplicates(items)
            self.logger.info("Successfully fetched NU.nl feed",
                           total_entries=len(feed.entries),
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching NU.nl RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching NU.nl RSS: {e}")

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching NU.nl RSS feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching NU.nl RSS: {e}")

        except Exception as e:
            self.logger.error("Unexpected error fetching NU.nl RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Unexpected error fetching NU.nl RSS: {e}")

    def _parse_entry(self, entry: Any, feed: Any) -> FeedItem:
        """Parse a single RSS entry into a FeedItem."""
        # Extract GUID - try id first, then link as fallback
        guid = getattr(entry, "id", None) or getattr(entry, "link", None)
        if not guid:
            raise ValueError("Entry has no ID or link")

        # Extract URL
        url = getattr(entry, "link", None)
        if not url:
            raise ValueError("Entry has no link")

        # Extract title
        title = getattr(entry, "title", "").strip()
        if not title:
            raise ValueError("Entry has no title")

        # Extract summary/description
        summary = None
        if hasattr(entry, "summary"):
            summary = self._clean_html(entry.summary)
        elif hasattr(entry, "description"):
            summary = self._clean_html(entry.description)

        # Parse publication date
        published_at = self._parse_date(entry)

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "feed_title": getattr(feed.feed, "title", "NU.nl"),
            "feed_link": getattr(feed.feed, "link", ""),
            "categories": [tag.term for tag in getattr(entry, "tags", [])],
            "author": getattr(entry, "author", ""),
        }

        return FeedItem(
            guid=guid,
            url=url,
            title=title,
            summary=summary,
            published_at=published_at,
            source_metadata=source_metadata
        )

    def _parse_date(self, entry: Any) -> datetime:
        """Parse publication date from RSS entry."""
        # Try different date fields
        date_fields = ["published", "updated", "created"]

        for field in date_fields:
            if hasattr(entry, field):
                date_str = getattr(entry, field)
                try:
                    return parser.parse(date_str)
                except (ValueError, TypeError):
                    continue

        # Try parsed date fields
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                import time
                return datetime.fromtimestamp(time.mktime(entry.published_parsed))
            except (ValueError, TypeError, OverflowError):
                pass

        # Fallback to current time if no date found
        self.logger.warning("No valid publication date found, using current time",
                          entry_id=getattr(entry, "id", "unknown"))
        return datetime.now()

    def _clean_html(self, text: str) -> str:
        """Remove HTML tags and clean up text content."""
        if not text:
            return ""

        # Simple HTML tag removal
        clean_text = re.sub(r"<[^>]+>", "", text)

        # Clean up whitespace
        clean_text = re.sub(r"\s+", " ", clean_text).strip()

        return clean_text

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit - close HTTP session."""
        await self._session.aclose()