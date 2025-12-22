"""
AD (Algemeen Dagblad) RSS feed reader implementation.

Fetches and normalizes RSS feeds from AD.nl (DPG Media).
"""

import re
from datetime import datetime
from typing import List, Dict, Any
from dateutil import parser
import feedparser
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .base import FeedReader, FeedItem, FeedReaderError, http_client

# Regex to extract AD article ID from URL (e.g., ~a5f2f6c34 from the end of URL)
AD_ARTICLE_ID_PATTERN = re.compile(r"~([a-f0-9]+)/?$")


class AdRssReader(FeedReader):
    """RSS reader for AD.nl news feeds."""

    @property
    def id(self) -> str:
        """Return unique identifier for AD.nl feed reader."""
        return "ad_rss"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about AD.nl as a news source."""
        return {
            "name": "AD",
            "full_name": "Algemeen Dagblad",
            "spectrum": 5.5,  # AD is center/mainstream commercial (0=far-left, 10=far-right)
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
        Fetch and parse AD.nl RSS feed entries.

        Returns:
            List of normalized FeedItem objects.

        Raises:
            FeedReaderError: When fetching or parsing fails after retries.
        """
        try:
            self.logger.info("Fetching AD.nl RSS feed", feed_url=self.feed_url)

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
                    # Skip paid articles (AD uses dpp:paid attribute)
                    if self._is_paid_article(entry):
                        self.logger.debug("Skipping paid article",
                                        entry_id=getattr(entry, "id", "unknown"))
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
            self.logger.info("Successfully fetched AD.nl feed",
                           total_entries=len(feed.entries),
                           parsed_items=len(items),
                           unique_items=len(unique_items))

            return unique_items

        except httpx.RequestError as e:
            self.logger.error("Network error fetching AD.nl RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Network error fetching AD.nl RSS: {e}")

        except httpx.HTTPStatusError as e:
            self.logger.error("HTTP error fetching AD.nl RSS feed",
                            status_code=e.response.status_code,
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"HTTP error fetching AD.nl RSS: {e}")

        except Exception as e:
            self.logger.error("Unexpected error fetching AD.nl RSS feed",
                            error=str(e), feed_url=self.feed_url)
            raise FeedReaderError(f"Unexpected error fetching AD.nl RSS: {e}")

    def _is_paid_article(self, entry: Any) -> bool:
        """Check if the article is behind a paywall using DPG Media's dpp:paid attribute."""
        # Check for dpp_paid attribute (feedparser converts dpp:paid to dpp_paid)
        if hasattr(entry, "dpp_paid"):
            return str(entry.dpp_paid).lower() == "true"
        # Also check in the raw XML if present
        if hasattr(entry, "tags"):
            for tag in entry.tags:
                if hasattr(tag, "term") and tag.term.lower() == "premium":
                    return True
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

        # Extract canonical article ID for deduplication
        article_id = self._extract_article_id(url)

        # Build source metadata
        source_metadata = {
            **self.source_metadata,
            "feed_title": getattr(feed.feed, "title", "AD.nl"),
            "feed_link": getattr(feed.feed, "link", ""),
            "categories": [tag.term for tag in getattr(entry, "tags", [])],
            "author": getattr(entry, "author", ""),
            "source_article_id": article_id,  # Used for cross-poll deduplication
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
        # Try media:content first (AD uses this format)
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

        # Try enclosures (standard RSS 2.0)
        enclosures = getattr(entry, "enclosures", [])
        for enc in enclosures:
            enc_type = getattr(enc, "type", "") or ""
            enc_url = getattr(enc, "href", None) or getattr(enc, "url", None)
            if enc_url and enc_type.startswith("image/"):
                return enc_url

        return None

    def _extract_article_id(self, url: str) -> str | None:
        """Extract the canonical article ID from an AD URL.

        AD URLs have the pattern: https://www.ad.nl/section/slug~ARTICLE_ID/
        The article ID (e.g., 'a5f2f6c34') stays constant even when the slug changes
        for LIVE articles that get updated.
        """
        match = AD_ARTICLE_ID_PATTERN.search(url)
        return match.group(1) if match else None

    def _filter_duplicates(self, items: List[FeedItem]) -> List[FeedItem]:
        """Remove duplicate items based on canonical article ID.

        AD.nl LIVE articles change their URL slug when updated, but keep the same
        article ID (e.g., ~a5f2f6c34). We deduplicate on this ID to avoid storing
        multiple versions of the same article.
        """
        seen_article_ids = set()
        seen_guids = set()
        filtered_items = []

        for item in items:
            # Try to extract canonical article ID from URL
            article_id = self._extract_article_id(item.url)

            if article_id:
                # Deduplicate by article ID (handles LIVE article updates)
                if article_id in seen_article_ids:
                    self.logger.debug(
                        "Filtering duplicate item by article ID",
                        article_id=article_id,
                        url=item.url,
                        title=item.title,
                    )
                    continue
                seen_article_ids.add(article_id)
            else:
                # Fallback to GUID deduplication for URLs without article ID
                if item.guid in seen_guids:
                    self.logger.debug(
                        "Filtering duplicate item by GUID",
                        guid=item.guid,
                        url=item.url,
                        title=item.title,
                    )
                    continue
                seen_guids.add(item.guid)

            filtered_items.append(item)

        self.logger.info(
            "Filtered feed items",
            total_items=len(items),
            unique_items=len(filtered_items),
            duplicates_removed=len(items) - len(filtered_items),
        )

        return filtered_items
