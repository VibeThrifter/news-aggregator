"""Graph-based scoring for event clustering.

Instead of comparing articles to event centroids, this approach:
1. Finds similar articles via vector index (graph edges)
2. Groups similar articles by their event_id
3. Scores events based on graph connectivity (how many neighbors are in that event)
4. Uses event_type as hard constraint
5. Boosts scores for matching dates/locations
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Dict, List, Optional, Set, Tuple, TYPE_CHECKING

from backend.app.core.logging import get_logger

if TYPE_CHECKING:
    from backend.app.db.models import Article, Event

logger = get_logger(__name__)


@dataclass(frozen=True)
class SimilarArticle:
    """An article similar to the query article, with its distance."""

    article_id: int
    event_id: Optional[int]
    distance: float  # from vector index (lower is more similar)
    event_type: Optional[str]
    extracted_dates: List[str]
    extracted_locations: List[str]


@dataclass(frozen=True)
class GraphScoreBreakdown:
    """Detailed breakdown of graph-based scoring."""

    connectivity: float  # ratio of neighbors in this event
    avg_similarity: float  # average similarity to neighbors in this event
    location_boost: float  # bonus for matching locations
    date_boost: float  # bonus for matching dates
    time_decay: float  # decay based on event staleness
    final: float  # combined score

    def as_dict(self) -> Dict[str, float]:
        return {
            "connectivity": self.connectivity,
            "avg_similarity": self.avg_similarity,
            "location_boost": self.location_boost,
            "date_boost": self.date_boost,
            "time_decay": self.time_decay,
            "final": self.final,
        }


def compute_graph_score(
    article_event_type: str,
    article_dates: List[str],
    article_locations: List[str],
    article_published_at: datetime | None,
    event_id: int,
    event_type: str | None,
    event_last_updated: datetime,
    similar_articles: List[SimilarArticle],
    *,
    time_decay_half_life_hours: float = 36.0,
    time_decay_floor: float = 0.25,
    now: datetime | None = None,
) -> GraphScoreBreakdown:
    """
    Compute graph-based score for assigning article to event.

    Args:
        article_event_type: Type of the query article
        article_dates: Extracted dates from query article
        article_locations: Extracted locations from query article
        article_published_at: When article was published
        event_id: ID of candidate event
        event_type: Type of candidate event
        event_last_updated: When event was last updated
        similar_articles: List of similar articles from vector index
        time_decay_half_life_hours: Half-life for time decay
        time_decay_floor: Minimum time decay multiplier
        now: Current time (for testing)

    Returns:
        GraphScoreBreakdown with final score
    """
    # Hard constraint: event types must match
    if event_type and article_event_type != event_type:
        logger.debug(
            "graph_score_type_mismatch",
            article_type=article_event_type,
            event_type=event_type,
            event_id=event_id,
        )
        return GraphScoreBreakdown(0.0, 0.0, 0.0, 0.0, 1.0, 0.0)

    # Find neighbors (similar articles) that belong to this event
    event_neighbors = [sa for sa in similar_articles if sa.event_id == event_id]

    if not event_neighbors:
        # No connections to this event in the graph
        return GraphScoreBreakdown(0.0, 0.0, 0.0, 0.0, 1.0, 0.0)

    # Connectivity: what fraction of neighbors are in this event?
    connectivity = len(event_neighbors) / len(similar_articles)

    # Convert distances to similarities (distance 0 = similarity 1)
    # Assuming cosine distance in [0, 2], similarity = 1 - distance/2
    similarities = [1.0 - (sa.distance / 2.0) for sa in event_neighbors]
    avg_similarity = sum(similarities) / len(similarities)

    # Location boost: +0.10 if any location matches neighbors
    location_boost = 0.0
    article_loc_set = {loc.lower() for loc in article_locations}
    if article_loc_set:
        neighbor_locs = {
            loc.lower()
            for sa in event_neighbors
            for loc in sa.extracted_locations
        }
        if article_loc_set.intersection(neighbor_locs):
            location_boost = 0.10

    # Date boost: +0.05 if any date matches neighbors
    date_boost = 0.0
    article_date_set = {date.lower() for date in article_dates}
    if article_date_set:
        neighbor_dates = {
            date.lower()
            for sa in event_neighbors
            for date in sa.extracted_dates
        }
        if article_date_set.intersection(neighbor_dates):
            date_boost = 0.05

    # Time decay: penalize old events
    time_decay = _compute_time_decay(
        article_time=article_published_at,
        event_last_updated=event_last_updated,
        half_life_hours=time_decay_half_life_hours,
        floor=time_decay_floor,
        now=now,
    )

    # Final score: weighted combination
    base_score = (connectivity * 0.4) + (avg_similarity * 0.6)
    final = (base_score + location_boost + date_boost) * time_decay

    return GraphScoreBreakdown(
        connectivity=connectivity,
        avg_similarity=avg_similarity,
        location_boost=location_boost,
        date_boost=date_boost,
        time_decay=time_decay,
        final=min(final, 1.0),  # cap at 1.0
    )


def _compute_time_decay(
    *,
    article_time: datetime | None,
    event_last_updated: datetime,
    half_life_hours: float,
    floor: float,
    now: datetime | None,
) -> float:
    """Compute time decay multiplier."""
    if half_life_hours <= 0:
        return 1.0

    reference_now = now or datetime.now(timezone.utc)
    article_ref = article_time or reference_now
    event_ref = event_last_updated

    # Ensure timezone-aware
    if article_ref.tzinfo is None:
        article_ref = article_ref.replace(tzinfo=timezone.utc)
    if event_ref.tzinfo is None:
        event_ref = event_ref.replace(tzinfo=timezone.utc)
    if reference_now.tzinfo is None:
        reference_now = reference_now.replace(tzinfo=timezone.utc)

    delta = article_ref - event_ref
    hours = delta.total_seconds() / 3600.0
    if hours <= 0:
        return 1.0

    decay = math.pow(0.5, hours / half_life_hours)
    return max(floor, decay)


__all__ = [
    "SimilarArticle",
    "GraphScoreBreakdown",
    "compute_graph_score",
]
