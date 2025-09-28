"""RSS feed reader plugins for news aggregation."""

from .base import FeedReader, FeedItem, FeedReaderError

__all__ = ["FeedReader", "FeedItem", "FeedReaderError"]