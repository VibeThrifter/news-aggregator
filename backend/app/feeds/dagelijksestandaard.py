"""
De Dagelijkse Standaard RSS feed reader implementation.

Fetches and normalizes the RSS feed of De Dagelijkse Standaard (Dutch conservative-right news
site). The site has no /feed/ (it answers 308 to /feed, a 404); its homepage links an RSS 2.0
feed at /sitemap/news.xml. That feed gives a teaser of ~300 characters, so the ingest fetches
the page for the full text (source_profiles.yaml: dagelijksestandaard_rss).
"""

import html
import re
from datetime import datetime
from typing import Any

import feedparser
import httpx
from dateutil import parser
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import FeedItem, FeedReader, FeedReaderError, http_client


class DagelijkseStandaardRssReader(FeedReader):
    """RSS reader for De Dagelijkse Standaard feeds."""

    @property
    def id(self) -> str:
        """Return unique identifier for De Dagelijkse Standaard feed reader."""
        return "dagelijksestandaard_rss"

    @property
    def source_metadata(self) -> dict[str, Any]:
        """Return metadata about De Dagelijkse Standaard as a news source."""
        return {
            "name": "De Dagelijkse Standaard",
            "full_name": "De Dagelijkse Standaard",
            "spectrum": 9,  # Right-wing perspective, like NieuwRechts (0=far-left, 10=far-right)
            "country": "NL",
            "language": "nl",
            "media_type": "online_news"
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def fetch(self) -> list[FeedItem]:
        """
        Fetch and parse De Dagelijkse Standaard RSS feed entries.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching De Dagelijkse Standaard RSS feed", feed_url=self.feed_url)

            # Fetch RSS content with properly managed HTTP client
            async with http_client() as client:
                response = await client.get(self.feed_url)
                response.raise_for_status()
                content = response.content

            # Parse with feedparser (outside context - client no longer needed)
            feed = feedparser.parse(content)

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
            self.logger.info("Successfully fetched De Dagelijkse Standaard feed",
                           total_entries=len(feed.entries),
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching De Dagelijkse Standaard RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching De Dagelijkse Standaard RSS: {e}") from e

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching De Dagelijkse Standaard RSS feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching De Dagelijkse Standaard RSS: {e}") from e

        except Exception as e:
            self.logger.error("Unexpected error fetching De Dagelijkse Standaard RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(
                f"Unexpected error fetching De Dagelijkse Standaard RSS: {e}"
            ) from e

    def _parse_entry(self, entry: Any, feed: Any) -> FeedItem:
        """Parse a single RSS entry into a FeedItem."""
        # Extract GUID - try id first (urn:uuid:...), then link as fallback
        guid = getattr(entry, "id", None) or getattr(entry, "link", None)
        if not guid:
            raise ValueError("Entry has no ID or link")

        # Extract URL
        url = getattr(entry, "link", None)
        if not url:
            raise ValueError("Entry has no link")

        # Extract title
        title = html.unescape(getattr(entry, "title", "")).strip()
        if not title:
            raise ValueError("Entry has no title")

        # Extract summary/description (a teaser that ends in "..." and an <img>)
        summary = None
        if hasattr(entry, "description"):
            summary = self._clean_html(entry.description)
        elif hasattr(entry, "summary"):
            summary = self._clean_html(entry.summary)

        # Parse publication date
        published_at = self._parse_date(entry)

        # Extract categories
        categories = []
        if hasattr(entry, "tags"):
            categories = [tag.term for tag in entry.tags if hasattr(tag, "term")]
        elif hasattr(entry, "category"):
            categories = [entry.category]

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "feed_title": getattr(feed.feed, "title", "De Dagelijkse Standaard"),
            "feed_link": getattr(feed.feed, "link", ""),
            "categories": categories,
        }

        return FeedItem(
            guid=guid,
            url=url,
            title=title,
            summary=summary,
            published_at=published_at,
            source_metadata=source_metadata,
            image_url=self._image_url(entry),
        )

    @staticmethod
    def _image_url(entry: Any) -> str | None:
        """The article image from <enclosure>, or None."""
        for enclosure in getattr(entry, "enclosures", None) or []:
            href = enclosure.get("href") or enclosure.get("url")
            if href and str(enclosure.get("type", "")).startswith("image/"):
                return href
        return None

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
        """Remove HTML tags and entities and clean up text content."""
        if not text:
            return ""

        # Simple HTML tag removal, then entities (&#8211; -> –)
        clean_text = html.unescape(re.sub(r"<[^>]+>", "", text))

        # Clean up whitespace
        clean_text = re.sub(r"\s+", " ", clean_text).strip()

        return clean_text
