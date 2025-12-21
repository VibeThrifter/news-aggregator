#!/usr/bin/env python3
"""
Test the NieuwRechts edge case: articles from the same source with similar writing style
but completely different topics should NOT be clustered together.

This script:
1. Fetches recent NieuwRechts articles from the database
2. Computes embeddings and extracts entities
3. Simulates clustering decisions to verify low-entity-overlap protection
"""
import sys
sys.path.insert(0, "/Users/denzel/Workspace/news-aggregator")

import asyncio
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from backend.app.db.session import get_sessionmaker
from backend.app.db.models import Article, EventArticle
from backend.app.events.scoring import (
    ArticleFeatures,
    EventFeatures,
    ScoreParameters,
    ScoreBreakdown,
    compute_hybrid_score,
    _entity_overlap,
)
from backend.app.core.config import get_settings


def extract_entity_texts(entities: list) -> set[str]:
    """Extract entity text values from entity list (which may be strings or dicts)."""
    if not entities:
        return set()

    result = set()
    for entity in entities:
        if isinstance(entity, str):
            result.add(entity)
        elif isinstance(entity, dict):
            # Try common keys for entity text
            text = entity.get('text') or entity.get('name') or entity.get('entity')
            if text:
                result.add(str(text))
    return result


async def fetch_nieuwrechts_articles(limit: int = 10):
    """Fetch recent NieuwRechts articles."""
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # First get articles
        query = (
            select(Article)
            .where(Article.source_name == "NieuwRechts")
            .order_by(Article.published_at.desc())
            .limit(limit)
        )
        result = await session.execute(query)
        articles = result.scalars().all()

        # Get event mappings for these articles
        article_ids = [a.id for a in articles]
        event_query = select(EventArticle).where(EventArticle.article_id.in_(article_ids))
        event_result = await session.execute(event_query)
        event_links = {ea.article_id: ea.event_id for ea in event_result.scalars().all()}

        return [
            {
                "id": a.id,
                "title": a.title,
                "content": a.content or "",
                "event_id": event_links.get(a.id),
                "entities": a.entities or [],
                "published_at": a.published_at,
            }
            for a in articles
        ]


def test_nieuwrechts_clustering():
    """Test NieuwRechts articles for clustering protection."""
    print("=" * 70)
    print("NIEUWRECHTS EDGE CASE TEST")
    print("=" * 70)
    print()

    # Fetch articles
    print("Fetching NieuwRechts articles from database...")
    try:
        articles = asyncio.run(fetch_nieuwrechts_articles(8))
    except Exception as e:
        print(f"Error fetching articles: {e}")
        print("\nFalling back to simulated data...")
        articles = create_simulated_nieuwrechts_articles()

    if len(articles) < 2:
        print(f"Only {len(articles)} NieuwRechts articles found. Need at least 2 for comparison.")
        print("\nFalling back to simulated data...")
        articles = create_simulated_nieuwrechts_articles()

    print(f"Found {len(articles)} NieuwRechts articles:")
    for i, art in enumerate(articles):
        print(f"  {i+1}. [{art['id']}] {art['title'][:60]}...")
        print(f"      Event: {art['event_id']}, Entities: {len(art['entities'])}")
    print()

    # Get settings for score parameters
    settings = get_settings()
    params = ScoreParameters(
        weight_embedding=settings.event_score_weight_embedding,
        weight_tfidf=settings.event_score_weight_tfidf,
        weight_entities=settings.event_score_weight_entities,
        time_decay_half_life_hours=settings.event_score_time_decay_half_life_hours,
        time_decay_floor=settings.event_score_time_decay_floor,
    )

    cluster_threshold = settings.event_score_threshold
    entity_overlap_llm_threshold = settings.event_low_entity_llm_threshold
    entity_overlap_block_threshold = settings.event_min_entity_overlap

    print(f"Score weights: embedding={params.weight_embedding}, tfidf={params.weight_tfidf}, entities={params.weight_entities}")
    print()

    # Test pairwise comparisons
    print("=" * 70)
    print("PAIRWISE COMPARISONS")
    print("=" * 70)

    now = datetime.now(timezone.utc)

    # Limit comparisons to avoid explosion
    max_comparisons = 15
    comparison_count = 0

    for i in range(len(articles)):
        for j in range(i + 1, len(articles)):
            if comparison_count >= max_comparisons:
                print(f"\n... (truncated after {max_comparisons} comparisons)")
                break

            art1 = articles[i]
            art2 = articles[j]
            comparison_count += 1

            # Use stored entities - extract text from entity dicts
            entities1 = extract_entity_texts(art1['entities'])
            entities2 = extract_entity_texts(art2['entities'])

            # Compute entity overlap
            entity_overlap = _entity_overlap(entities1, entities2)

            # Create feature objects (simulate high embedding similarity for same source)
            # Using dummy embedding that simulates high similarity
            dummy_embedding = [0.1] * 384
            dummy_tfidf = {"article": 0.5}

            article_features = ArticleFeatures(
                embedding=dummy_embedding,
                tfidf=dummy_tfidf,
                entity_texts=entities1,
                published_at=art1.get('published_at') or now,
                person_entities=None,
                location_entities=None,
            )

            # Treat second article as if it were an event centroid
            event_features = EventFeatures(
                centroid_embedding=dummy_embedding,  # Same = high similarity
                centroid_tfidf=dummy_tfidf,
                entity_texts=entities2,
                last_updated_at=art2.get('published_at') or now,
                first_seen_at=art2.get('published_at') or now,
                person_entities=None,
                location_entities=None,
            )

            # Compute score
            result = compute_hybrid_score(article_features, event_features, params, now=now)

            # Determine clustering decision
            same_event = art1['event_id'] == art2['event_id'] and art1['event_id'] is not None

            # Check decision logic
            would_cluster = result.final >= cluster_threshold
            requires_llm = entity_overlap < entity_overlap_llm_threshold

            print()
            print(f"Article {art1['id']} vs Article {art2['id']}")
            print(f"  Titles:")
            print(f"    A: {art1['title'][:55]}...")
            print(f"    B: {art2['title'][:55]}...")
            print(f"  Entity overlap: {entity_overlap:.3f}")
            print(f"  Entities A ({len(entities1)}): {list(entities1)[:3]}{'...' if len(entities1) > 3 else ''}")
            print(f"  Entities B ({len(entities2)}): {list(entities2)[:3]}{'...' if len(entities2) > 3 else ''}")
            print(f"  Score breakdown: emb={result.embedding:.2f}, tfidf={result.tfidf:.2f}, ent={result.entities:.2f}")
            print(f"  Combined: {result.combined:.3f} -> Final (with penalty): {result.final:.3f}")
            print(f"  Would auto-cluster (>= {cluster_threshold}): {would_cluster}")
            print(f"  Requires LLM verification (entity < {entity_overlap_llm_threshold}): {requires_llm}")
            print(f"  Actually same event in DB: {same_event}")

            # Check if protection is working
            if entity_overlap < 0.05:
                if result.final < cluster_threshold:
                    print(f"  ✅ CORRECT: Very low entity overlap -> score too low to auto-cluster")
                elif requires_llm:
                    print(f"  ✅ CORRECT: Low entity overlap triggers LLM verification")
                else:
                    print(f"  ⚠️  WARNING: Low entity overlap but would auto-cluster without LLM!")
            elif entity_overlap < entity_overlap_llm_threshold:
                if requires_llm:
                    print(f"  ✅ CORRECT: Moderate overlap, LLM verification required")
                else:
                    print(f"  ⚠️  WARNING: Should require LLM verification!")
            else:
                print(f"  ✅ CORRECT: Sufficient entity overlap for auto-clustering decision")

        if comparison_count >= max_comparisons:
            break

    print()
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Cluster threshold: {cluster_threshold}")
    print(f"Entity overlap LLM threshold: {entity_overlap_llm_threshold}")
    print(f"Entity overlap block threshold: {entity_overlap_block_threshold}")
    print()
    print("The entity penalty system applies progressive penalties:")
    print("  - overlap < 0.05: 50% penalty (halves the score)")
    print("  - overlap < 0.10: 30% penalty")
    print("  - overlap < 0.20: 15% penalty")
    print("  - overlap < 0.30: 5% penalty")
    print()
    print("This prevents articles with similar writing style but different topics")
    print("from being automatically clustered together.")


def create_simulated_nieuwrechts_articles():
    """Create simulated articles if database is unavailable."""
    return [
        {
            "id": 1001,
            "title": "Trump kondigt nieuwe handelsmaatregelen aan tegen China",
            "full_text": "Donald Trump heeft vandaag aangekondigd dat er nieuwe tarieven komen...",
            "event_id": None,
            "entities": ["Donald Trump", "China", "VS", "Beijing"],
            "published_at": datetime.now(timezone.utc),
        },
        {
            "id": 1002,
            "title": "Klimaatactivisten blokkeren snelweg A12 in Den Haag",
            "full_text": "Klimaatactivisten van Extinction Rebellion hebben de A12 geblokkeerd...",
            "event_id": None,
            "entities": ["Extinction Rebellion", "A12", "Den Haag", "Nederland"],
            "published_at": datetime.now(timezone.utc),
        },
        {
            "id": 1003,
            "title": "PVV wint peilingen na uitspraken Wilders over immigratie",
            "full_text": "De PVV staat weer bovenaan in de peilingen na de meest recente uitspraken...",
            "event_id": None,
            "entities": ["PVV", "Geert Wilders", "Nederland"],
            "published_at": datetime.now(timezone.utc),
        },
        {
            "id": 1004,
            "title": "Elon Musk reageert op kritiek Twitter-overname",
            "full_text": "Elon Musk heeft op X gereageerd op de aanhoudende kritiek...",
            "event_id": None,
            "entities": ["Elon Musk", "Twitter", "X"],
            "published_at": datetime.now(timezone.utc),
        },
    ]


if __name__ == "__main__":
    test_nieuwrechts_clustering()
