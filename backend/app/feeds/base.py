"""
Abstract base class for RSS feed readers.

This module defines the FeedReader interface that all feed readers must implement,
along with shared data models for normalized feed items.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import structlog

logger = structlog.get_logger()


@dataclass
class FeedItem:
    """Normalized representation of a feed item across different RSS sources."""

    guid: str  # Unique identifier from the feed
    url: str  # Article URL
    title: str
    summary: Optional[str]  # Description/excerpt from feed
    published_at: datetime  # Normalized to ISO format
    source_metadata: Dict[str, Any]  # Source-specific data

    def __post_init__(self):
        """Validate required fields after initialization."""
        if not self.guid:
            raise ValueError("FeedItem guid is required")
        if not self.url:
            raise ValueError("FeedItem url is required")
        if not self.title:
            raise ValueError("FeedItem title is required")


class FeedReader(ABC):
    """Abstract base class for RSS feed readers implementing the Strategy pattern."""

    def __init__(self, feed_url: str):
        """Initialize with the RSS feed URL."""
        self.feed_url = feed_url
        self.logger = logger.bind(feed_reader=self.id, feed_url=feed_url)

    @property
    @abstractmethod
    def id(self) -> str:
        """Return unique identifier for this feed reader."""
        pass

    @property
    @abstractmethod
    def source_metadata(self) -> Dict[str, Any]:
        """Return metadata about this feed source (name, spectrum, etc.)."""
        pass

    @abstractmethod
    async def fetch(self) -> List[FeedItem]:
        """
        Fetch and parse RSS feed entries, returning normalized FeedItem objects.

        Returns:
            List of normalized FeedItem objects with duplicates filtered by guid/URL.

        Raises:
            FeedReaderError: When feed fetching or parsing fails after retries.
        """
        pass

    def _filter_duplicates(self, items: List[FeedItem]) -> List[FeedItem]:
        """Remove duplicate items based on guid and URL."""
        seen_guids = set()
        seen_urls = set()
        filtered_items = []

        for item in items:
            if item.guid in seen_guids or item.url in seen_urls:
                self.logger.debug("Filtering duplicate item",
                                guid=item.guid, url=item.url, title=item.title)
                continue

            seen_guids.add(item.guid)
            seen_urls.add(item.url)
            filtered_items.append(item)

        self.logger.info("Filtered feed items",
                        total_items=len(items),
                        unique_items=len(filtered_items),
                        duplicates_removed=len(items) - len(filtered_items))

        return filtered_items


class FeedReaderError(Exception):
    """Exception raised when feed reading fails."""
    pass