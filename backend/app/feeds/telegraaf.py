"""
De Telegraaf RSS feed reader implementation.

Fetches and normalizes RSS feeds from De Telegraaf (largest Dutch newspaper).
Filters out premium/paywalled articles based on RSS <premium> tag.
"""

import re
from datetime import datetime
from typing import List, Dict, Any
from dateutil import parser
import feedparser
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .base import FeedReader, FeedItem, FeedReaderError, http_client


class TelegraafRssReader(FeedReader):
    """RSS reader for De Telegraaf news feeds."""

    @property
    def id(self) -> str:
        """Return unique identifier for Telegraaf feed reader."""
        return "telegraaf_rss"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about De Telegraaf as a news source."""
        return {
            "name": "De Telegraaf",
            "full_name": "De Telegraaf",
            "spectrum": 7,  # Telegraaf is considered populist/tabloid (0=far-left, 10=far-right)
            "country": "NL",
            "language": "nl",
            "media_type": "tabloid"
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def fetch(self) -> List[FeedItem]:
        """
        Fetch and parse De Telegraaf RSS feed entries.

        Filters out premium/paywalled articles.

        Returns:
            List of normalized FeedItem objects (non-premium only).

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching Telegraaf RSS feed", feed_url=self.feed_url)

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

            # Convert entries to normalized FeedItems, skipping premium articles and videos
            items = []
            premium_count = 0
            video_count = 0
            for entry in feed.entries:
                try:
                    # Check if article is premium/paywalled
                    if self._is_premium_article(entry):
                        premium_count += 1
                        self.logger.debug("Skipping premium article",
                                        entry_id=getattr(entry, "id", "unknown"),
                                        title=getattr(entry, "title", "unknown"))
                        continue

                    # Skip video pages - they have minimal article content
                    url = getattr(entry, "link", "")
                    if "/video/" in url:
                        video_count += 1
                        continue

                    item = self._parse_entry(entry, feed)
                    items.append(item)
                except Exception as e:
                    self.logger.warning("Failed to parse feed entry",
                                      entry_id=getattr(entry, "id", "unknown"),
                                      error=str(e))
                    continue

            # Filter duplicates and return
            unique_items = self._filter_duplicates(items)
            self.logger.info("Successfully fetched Telegraaf feed",
                           total_entries=len(feed.entries),
                           premium_skipped=premium_count,
                           video_skipped=video_count,
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching Telegraaf RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching Telegraaf RSS: {e}")

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching Telegraaf RSS feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching Telegraaf RSS: {e}")

        except Exception as e:
            self.logger.error("Unexpected error fetching Telegraaf RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Unexpected error fetching Telegraaf RSS: {e}")

    def _is_premium_article(self, entry: Any) -> bool:
        """
        Check if the article is behind a paywall using Telegraaf's <premium> tag.

        The Telegraaf RSS feed includes <premium>true</premium> or <premium>false</premium>
        for each item.
        """
        # feedparser converts <premium> to entry.premium attribute
        if hasattr(entry, "premium"):
            return str(entry.premium).lower() == "true"

        # Also check in the raw XML structure if available
        # Some parsers might store it differently
        if hasattr(entry, "get"):
            premium_val = entry.get("premium", "false")
            return str(premium_val).lower() == "true"

        return False

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

        # Extract category
        categories = []
        if hasattr(entry, "tags"):
            categories = [tag.term for tag in entry.tags if hasattr(tag, "term")]
        elif hasattr(entry, "category"):
            categories = [entry.category]

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "feed_title": getattr(feed.feed, "title", "De Telegraaf"),
            "feed_link": getattr(feed.feed, "link", ""),
            "categories": categories,
            "author": getattr(entry, "author", "") or getattr(entry, "dc_creator", ""),
        }

        # Extract image URL from media:content or enclosure
        image_url = self._extract_image_url(entry)

        return FeedItem(
            guid=guid,
            url=url,
            title=title,
            summary=summary,
            published_at=published_at,
            source_metadata=source_metadata,
            image_url=image_url,
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

    def _extract_image_url(self, entry: Any) -> str | None:
        """Extract image URL from RSS enclosure or media:content."""
        # Try media:content first (Telegraaf uses this format)
        media_content = getattr(entry, "media_content", [])
        for media in media_content:
            media_type = media.get("type", "") or media.get("medium", "")
            media_url = media.get("url")
            if media_url and ("image" in media_type or media_type == "" or media_type == "image"):
                return media_url

        # Try media:thumbnail
        media_thumbnail = getattr(entry, "media_thumbnail", [])
        if media_thumbnail and len(media_thumbnail) > 0:
            return media_thumbnail[0].get("url")

        # Try enclosures (standard RSS 2.0)
        enclosures = getattr(entry, "enclosures", [])
        for enc in enclosures:
            enc_type = getattr(enc, "type", "") or ""
            enc_url = getattr(enc, "href", None) or getattr(enc, "url", None)
            if enc_url and ("image" in enc_type):
                return enc_url

        return None
