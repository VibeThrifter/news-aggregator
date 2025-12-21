"""Repository layer exports."""

from .article_repo import (
    ArticleEnrichmentPayload,
    ArticlePersistenceResult,
    ArticleRepository,
)
from .event_repo import EventCentroidSnapshot, EventMaintenanceBundle, EventRepository
from .insight_repo import InsightPersistenceResult, InsightRepository
from .source_repo import NewsSourceRepository, SourcePersistenceResult

__all__ = [
    "ArticleEnrichmentPayload",
    "ArticleRepository",
    "ArticlePersistenceResult",
    "InsightPersistenceResult",
    "InsightRepository",
    "EventMaintenanceBundle",
    "EventRepository",
    "EventCentroidSnapshot",
    "NewsSourceRepository",
    "SourcePersistenceResult",
]
