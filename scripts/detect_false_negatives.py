#!/usr/bin/env python3
"""
Detect potential false negatives in event clustering.

This script identifies articles that may have been incorrectly placed in separate events
when they should have been clustered together. It analyzes:
1. Singleton articles from the same day with same event_type
2. Pairwise similarity between potentially related articles
3. Location/entity overlap for local events (crime, accidents)
4. Temporal proximity and semantic similarity

Usage:
    python scripts/detect_false_negatives.py [--days N] [--min-score X]
"""

import asyncio
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Tuple
import argparse

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, func, and_
from backend.app.db.session import get_sessionmaker
from backend.app.db.models import Article, Event, EventArticle
from backend.app.services.event_service import _article_to_features, _event_to_features
from backend.app.events.scoring import compute_hybrid_score, ScoreParameters
from backend.app.core.config import get_settings


class FalseNegativeCandidate:
    """A potential false negative: two articles that should cluster but don't."""

    def __init__(
        self,
        article1: Article,
        article2: Article,
        event1_id: int,
        event2_id: int,
        similarity_score: float,
        embedding_sim: float,
        entity_overlap: float,
        location_overlap: bool,
        same_day: bool,
    ):
        self.article1 = article1
        self.article2 = article2
        self.event1_id = event1_id
        self.event2_id = event2_id
        self.similarity_score = similarity_score
        self.embedding_sim = embedding_sim
        self.entity_overlap = entity_overlap
        self.location_overlap = location_overlap
        self.same_day = same_day


async def get_candidate_pairs(
    session,
    days: int,
    event_types: List[str] | None = None,
) -> List[Tuple[Article, Article, int, int]]:
    """
    Get pairs of articles in different singleton events that might be false negatives.

    Returns:
        List of (article1, article2, event1_id, event2_id) tuples
    """
    # Get singleton events from the last N days
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

    # Find singleton events (article_count = 1)
    singleton_events_stmt = (
        select(Event.id)
        .where(
            and_(
                Event.article_count == 1,
                Event.last_updated_at >= cutoff_date,
            )
        )
    )

    singleton_event_ids_result = await session.execute(singleton_events_stmt)
    singleton_event_ids = [row[0] for row in singleton_event_ids_result.all()]

    if not singleton_event_ids:
        return []

    # Get articles in these singleton events
    articles_stmt = (
        select(Article, EventArticle.event_id)
        .join(EventArticle, Article.id == EventArticle.article_id)
        .where(
            and_(
                EventArticle.event_id.in_(singleton_event_ids),
                Article.enriched_at.isnot(None),
                Article.embedding.isnot(None),
            )
        )
    )

    if event_types:
        articles_stmt = articles_stmt.where(Article.event_type.in_(event_types))

    result = await session.execute(articles_stmt)
    articles_with_events = result.all()

    # Group by event_type and date for comparison
    grouped: Dict[Tuple[str, str], List[Tuple[Article, int]]] = {}

    for article, event_id in articles_with_events:
        if not article.published_at or not article.event_type:
            continue

        date_key = article.published_at.date().isoformat()
        type_key = article.event_type
        key = (type_key, date_key)

        if key not in grouped:
            grouped[key] = []
        grouped[key].append((article, event_id))

    # Generate candidate pairs within each group
    pairs = []
    for group_articles in grouped.values():
        if len(group_articles) < 2:
            continue

        # Compare all pairs in this group
        for i, (article1, event1_id) in enumerate(group_articles):
            for article2, event2_id in group_articles[i + 1:]:
                if event1_id != event2_id:
                    pairs.append((article1, article2, event1_id, event2_id))

    return pairs


async def evaluate_pair(
    article1: Article,
    article2: Article,
    params: ScoreParameters,
) -> Tuple[float, float, float, bool]:
    """
    Evaluate if two articles should have clustered together.

    Returns:
        (hybrid_score, embedding_similarity, entity_overlap, location_match)
    """
    features1, _ = _article_to_features(article1)
    features2, _ = _article_to_features(article2)

    # Create pseudo-event from article2 to use scoring system
    from backend.app.events.scoring import EventFeatures

    event2_features = EventFeatures(
        centroid_embedding=features2.embedding,
        centroid_tfidf=features2.tfidf,
        entity_texts=features2.entity_texts,
        last_updated_at=article2.published_at or article2.fetched_at,
        first_seen_at=article2.published_at or article2.fetched_at,
        person_entities=features2.person_entities,
        location_entities=features2.location_entities,
    )

    breakdown = compute_hybrid_score(features1, event2_features, params)

    # Check location overlap
    locs1 = set(loc.lower() for loc in (article1.extracted_locations or []))
    locs2 = set(loc.lower() for loc in (article2.extracted_locations or []))
    location_match = bool(locs1 and locs2 and locs1.intersection(locs2))

    return (breakdown.final, breakdown.embedding, breakdown.entities, location_match)


async def detect_false_negatives(
    days: int = 14,
    min_score: float = 0.75,
    event_types: List[str] | None = None,
) -> List[FalseNegativeCandidate]:
    """
    Detect potential false negatives in clustering.

    Args:
        days: Look back this many days
        min_score: Minimum similarity score to flag as potential false negative
        event_types: Limit to specific event types (None = all types)

    Returns:
        List of FalseNegativeCandidate objects
    """
    settings = get_settings()
    session_factory = get_sessionmaker()

    params = ScoreParameters(
        weight_embedding=settings.event_score_weight_embedding,
        weight_tfidf=settings.event_score_weight_tfidf,
        weight_entities=settings.event_score_weight_entities,
        time_decay_half_life_hours=settings.event_score_time_decay_half_life_hours,
        time_decay_floor=settings.event_score_time_decay_floor,
    )

    async with session_factory() as session:
        pairs = await get_candidate_pairs(session, days, event_types)

        false_negatives = []

        for article1, article2, event1_id, event2_id in pairs:
            hybrid_score, emb_sim, entity_overlap, loc_match = await evaluate_pair(
                article1, article2, params
            )

            # Flag as potential false negative if score is high
            if hybrid_score >= min_score:
                same_day = (
                    article1.published_at
                    and article2.published_at
                    and article1.published_at.date() == article2.published_at.date()
                )

                fn = FalseNegativeCandidate(
                    article1=article1,
                    article2=article2,
                    event1_id=event1_id,
                    event2_id=event2_id,
                    similarity_score=hybrid_score,
                    embedding_sim=emb_sim,
                    entity_overlap=entity_overlap,
                    location_overlap=loc_match,
                    same_day=same_day,
                )
                false_negatives.append(fn)

        return false_negatives


def print_report(candidates: List[FalseNegativeCandidate], threshold: float):
    """Print a detailed report of potential false negatives."""

    print("=" * 100)
    print(f"🔍 FALSE NEGATIVE DETECTION REPORT")
    print("=" * 100)
    print()

    if not candidates:
        print("✅ No potential false negatives detected!")
        print(f"   All singleton events appear to be correctly separated.")
        print()
        return

    print(f"⚠️  Found {len(candidates)} potential false negative(s)")
    print(f"   (Articles with similarity ≥ {threshold} in different events)")
    print()

    # Sort by similarity score descending
    candidates.sort(key=lambda x: x.similarity_score, reverse=True)

    # Group by event_type
    by_type: Dict[str, List[FalseNegativeCandidate]] = {}
    for candidate in candidates:
        event_type = candidate.article1.event_type or "unknown"
        if event_type not in by_type:
            by_type[event_type] = []
        by_type[event_type].append(candidate)

    for event_type, type_candidates in sorted(by_type.items(), key=lambda x: len(x[1]), reverse=True):
        print(f"\n📌 Event Type: {event_type.upper()} ({len(type_candidates)} cases)")
        print("-" * 100)

        for i, fn in enumerate(type_candidates, 1):
            print(f"\n  Case #{i}:")
            print(f"    Score: {fn.similarity_score:.3f} (emb: {fn.embedding_sim:.3f}, ent: {fn.entity_overlap:.3f})")
            print(f"    Events: {fn.event1_id} vs {fn.event2_id}")
            print(f"    Same day: {'✓' if fn.same_day else '✗'} | Location overlap: {'✓' if fn.location_overlap else '✗'}")
            print(f"    Article 1: {fn.article1.title[:90]}")
            print(f"    Article 2: {fn.article2.title[:90]}")

            if fn.article1.extracted_locations or fn.article2.extracted_locations:
                locs1 = fn.article1.extracted_locations or []
                locs2 = fn.article2.extracted_locations or []
                print(f"    Locations: {locs1[:3]} vs {locs2[:3]}")

    print()
    print("=" * 100)

    # Summary statistics
    high_confidence = sum(1 for fn in candidates if fn.similarity_score >= 0.85)
    same_location = sum(1 for fn in candidates if fn.location_overlap)

    print(f"\n📊 Summary:")
    print(f"   Total potential false negatives: {len(candidates)}")
    print(f"   High confidence (≥0.85): {high_confidence}")
    print(f"   Same location: {same_location}")
    print(f"   By type: {', '.join(f'{t}={len(c)}' for t, c in by_type.items())}")
    print()


async def main():
    parser = argparse.ArgumentParser(description="Detect false negatives in event clustering")
    parser.add_argument("--days", type=int, default=14, help="Look back this many days (default: 14)")
    parser.add_argument("--min-score", type=float, default=0.75, help="Minimum score to flag (default: 0.75)")
    parser.add_argument("--type", action="append", dest="types", help="Filter by event type (can be repeated)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show verbose output")

    args = parser.parse_args()

    print(f"Analyzing last {args.days} days for potential false negatives...")
    print(f"Minimum similarity threshold: {args.min_score}")
    if args.types:
        print(f"Event types: {', '.join(args.types)}")
    print()

    candidates = await detect_false_negatives(
        days=args.days,
        min_score=args.min_score,
        event_types=args.types,
    )

    print_report(candidates, args.min_score)


if __name__ == "__main__":
    asyncio.run(main())
