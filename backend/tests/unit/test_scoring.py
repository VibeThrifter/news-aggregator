from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.events.scoring import (
    ArticleFeatures,
    EventFeatures,
    ScoreParameters,
    compute_hybrid_score,
)


def test_compute_hybrid_score_combines_weights() -> None:
    now = datetime.now(timezone.utc)
    article = ArticleFeatures(
        embedding=[1.0, 0.0, 0.0],
        tfidf={"news": 0.8, "update": 0.2},
        entity_texts={"den haag"},
        published_at=now,
    )
    event = EventFeatures(
        centroid_embedding=[1.0, 0.0, 0.0],
        centroid_tfidf={"news": 0.8, "update": 0.2},
        entity_texts={"den haag"},
        last_updated_at=now,
        first_seen_at=now - timedelta(hours=1),
    )
    params = ScoreParameters(
        weight_embedding=0.6,
        weight_tfidf=0.3,
        weight_entities=0.1,
        time_decay_half_life_hours=48.0,
        time_decay_floor=0.35,
    )

    breakdown = compute_hybrid_score(article, event, params, now=now)

    assert breakdown.embedding == pytest.approx(1.0)
    assert breakdown.tfidf == pytest.approx(1.0)
    assert breakdown.entities == pytest.approx(1.0)
    assert breakdown.time_decay == pytest.approx(1.0)
    assert breakdown.combined == pytest.approx(1.0)
    assert breakdown.final == pytest.approx(1.0)


def test_time_decay_reduces_score_respecting_floor() -> None:
    now = datetime.now(timezone.utc)
    article = ArticleFeatures(
        embedding=[1.0, 0.0],
        tfidf={"topic": 1.0},
        entity_texts={"amsterdam"},
        published_at=now,
    )
    event = EventFeatures(
        centroid_embedding=[1.0, 0.0],
        centroid_tfidf={"topic": 1.0},
        entity_texts={"amsterdam"},
        last_updated_at=now - timedelta(hours=72),
        first_seen_at=now - timedelta(hours=120),
    )
    params = ScoreParameters(
        weight_embedding=0.6,
        weight_tfidf=0.3,
        weight_entities=0.1,
        time_decay_half_life_hours=48.0,
        time_decay_floor=0.35,
    )

    breakdown = compute_hybrid_score(article, event, params, now=now)

    assert 0.35 <= breakdown.final < 1.0
    assert breakdown.time_decay >= 0.35


def test_missing_vectors_yield_zero_score() -> None:
    now = datetime.now(timezone.utc)
    article = ArticleFeatures(
        embedding=[],
        tfidf={},
        entity_texts=set(),
        published_at=now,
    )
    event = EventFeatures(
        centroid_embedding=None,
        centroid_tfidf=None,
        entity_texts=set(),
        last_updated_at=now,
        first_seen_at=now,
    )
    params = ScoreParameters(
        weight_embedding=0.6,
        weight_tfidf=0.3,
        weight_entities=0.1,
        time_decay_half_life_hours=48.0,
        time_decay_floor=0.35,
    )

    breakdown = compute_hybrid_score(article, event, params, now=now)

    assert breakdown.final == 0.0
    assert breakdown.combined == 0.0
