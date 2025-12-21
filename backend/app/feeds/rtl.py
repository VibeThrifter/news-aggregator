"""
RTL Nieuws RSS feed reader implementation.

Fetches and normalizes RSS feeds from RTL Nieuws (commercial broadcaster).
"""

import re
from datetime import datetime
from typing import List, Dict, Any
from dateutil import parser
import feedparser
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .base import FeedReader, FeedItem, FeedReaderError, http_client


class RtlRssReader(FeedReader):
    """RSS reader for RTL Nieuws feeds."""

    @property
    def id(self) -> str:
        """Return unique identifier for RTL feed reader."""
        return "rtl_rss"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about RTL as a news source."""
        return {
            "name": "RTL Nieuws",
            "full_name": "RTL Nederland",
            "spectrum": 5,  # RTL is a commercial broadcaster, center (0=far-left, 10=far-right)
            "country": "NL",
            "language": "nl",
            "media_type": "commercial_broadcaster"
        }

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def fetch(self) -> List[FeedItem]:
        """
        Fetch and parse RTL RSS feed entries.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching RTL RSS feed", feed_url=self.feed_url)

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
                    # Filter out non-news content (TV schedules, entertainment roundups)
                    if self._is_meta_content(item):
                        self.logger.debug("Skipping meta content", title=item.title)
                        continue
                    items.append(item)
                except Exception as e:
                    self.logger.warning("Failed to parse feed entry",
                                      entry_id=getattr(entry, "id", "unknown"),
                                      error=str(e))
                    continue

            # Filter duplicates and return
            unique_items = self._filter_duplicates(items)
            self.logger.info("Successfully fetched RTL feed",
                           total_entries=len(feed.entries),
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching RTL RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching RTL RSS: {e}")

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching RTL RSS feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching RTL RSS: {e}")

        except Exception as e:
            self.logger.error("Unexpected error fetching RTL RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Unexpected error fetching RTL RSS: {e}")

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
            "feed_title": getattr(feed.feed, "title", "RTL Nieuws"),
            "feed_link": getattr(feed.feed, "link", ""),
            "categories": [tag.term for tag in getattr(entry, "tags", [])],
            "author": getattr(entry, "author", ""),
        }

        # Extract image URL from enclosure
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
        # Try enclosures first (standard RSS 2.0)
        enclosures = getattr(entry, "enclosures", [])
        for enc in enclosures:
            enc_type = getattr(enc, "type", "") or ""
            enc_url = getattr(enc, "href", None) or getattr(enc, "url", None)
            if enc_url and enc_type.startswith("image/"):
                return enc_url

        # Try media:content (Media RSS extension)
        media_content = getattr(entry, "media_content", [])
        for media in media_content:
            media_type = media.get("type", "") or media.get("medium", "")
            media_url = media.get("url")
            if media_url and ("image" in media_type or media_type == ""):
                return media_url

        # Try media:thumbnail
        media_thumbnail = getattr(entry, "media_thumbnail", [])
        if media_thumbnail and len(media_thumbnail) > 0:
            return media_thumbnail[0].get("url")

        return None

    def _is_meta_content(self, item: FeedItem) -> bool:
        """
        Detect non-news content like TV schedules, program roundups,
        and entertainment summaries that should not be treated as news events.
        """
        title_lower = item.title.lower()
        summary_lower = (item.summary or "").lower()

        # TV schedule/programming content
        schedule_patterns = [
            r"veel te zien op rtl",
            r"vanavond op rtl",
            r"deze week op rtl",
            r"tv-?gids",
            r"programma.?overzicht",
            r"kijk\s*tip",
        ]
        for pattern in schedule_patterns:
            if re.search(pattern, title_lower) or re.search(pattern, summary_lower):
                return True

        # Generic "what's on" roundups
        if re.search(r"op (rtl\s*)?[0-9].*met verschillende", summary_lower):
            return True

        # Day-based TV summaries
        if re.search(r"op\s+(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag).*was er veel te zien", summary_lower):
            return True

        return False
