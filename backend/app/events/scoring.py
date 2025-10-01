"""Hybrid scoring utilities for article-to-event assignment."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping, Sequence, Set

from backend.app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class ArticleFeatures:
    """Normalized feature bundle extracted from an article."""

    embedding: Sequence[float]
    tfidf: Mapping[str, float]
    entity_texts: Set[str]
    published_at: datetime | None


@dataclass(frozen=True)
class EventFeatures:
    """Centroid feature bundle representing an existing event."""

    centroid_embedding: Sequence[float] | None
    centroid_tfidf: Mapping[str, float] | None
    entity_texts: Set[str]
    last_updated_at: datetime
    first_seen_at: datetime


@dataclass(frozen=True)
class ScoreParameters:
    """Runtime configuration for hybrid scoring."""

    weight_embedding: float
    weight_tfidf: float
    weight_entities: float
    time_decay_half_life_hours: float
    time_decay_floor: float


@dataclass(frozen=True)
class ScoreBreakdown:
    """Detailed breakdown of the hybrid score computation."""

    embedding: float
    tfidf: float
    entities: float
    time_decay: float
    combined: float
    final: float

    def as_dict(self) -> dict[str, float]:
        """Return a serialisable representation for persistence/logging."""

        return {
            "embedding": self.embedding,
            "tfidf": self.tfidf,
            "entities": self.entities,
            "time_decay": self.time_decay,
            "combined": self.combined,
            "final": self.final,
        }


def compute_hybrid_score(
    article: ArticleFeatures,
    event: EventFeatures,
    params: ScoreParameters,
    *,
    now: datetime | None = None,
) -> ScoreBreakdown:
    """Compute the weighted similarity between an article and an event."""

    weight_sum = params.weight_embedding + params.weight_tfidf + params.weight_entities
    if weight_sum <= 0:
        logger.warning("hybrid_score_invalid_weights", total_weight=weight_sum)
        return ScoreBreakdown(0.0, 0.0, 0.0, 1.0, 0.0, 0.0)

    embedding_similarity = _cosine_dense(article.embedding, event.centroid_embedding)
    tfidf_similarity = _cosine_sparse(article.tfidf, event.centroid_tfidf)
    entity_overlap = _entity_overlap(article.entity_texts, event.entity_texts)

    combined = (
        (params.weight_embedding * embedding_similarity)
        + (params.weight_tfidf * tfidf_similarity)
        + (params.weight_entities * entity_overlap)
    ) / weight_sum

    decay = _time_decay(
        article_time=article.published_at,
        last_updated=event.last_updated_at,
        half_life=params.time_decay_half_life_hours,
        floor=params.time_decay_floor,
        now=now,
    )

    final = _clamp(combined * decay)
    return ScoreBreakdown(
        embedding=_clamp(embedding_similarity),
        tfidf=_clamp(tfidf_similarity),
        entities=_clamp(entity_overlap),
        time_decay=_clamp(decay),
        combined=_clamp(combined),
        final=final,
    )


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def _cosine_dense(vector_a: Sequence[float], vector_b: Sequence[float] | None) -> float:
    if not vector_a or not vector_b:
        return 0.0

    dot = sum(a * b for a, b in zip(vector_a, vector_b))
    norm_a = math.sqrt(sum(a * a for a in vector_a))
    norm_b = math.sqrt(sum(b * b for b in vector_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return _clamp(dot / (norm_a * norm_b), -1.0, 1.0)


def _cosine_sparse(vec_a: Mapping[str, float] | None, vec_b: Mapping[str, float] | None) -> float:
    if not vec_a or not vec_b:
        return 0.0
    common = set(vec_a).intersection(vec_b)
    dot = sum(vec_a[token] * vec_b[token] for token in common)
    norm_a = math.sqrt(sum(value * value for value in vec_a.values()))
    norm_b = math.sqrt(sum(value * value for value in vec_b.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return _clamp(dot / (norm_a * norm_b), -1.0, 1.0)


def _entity_overlap(entities_a: Set[str], entities_b: Set[str]) -> float:
    if not entities_a or not entities_b:
        return 0.0
    intersection = entities_a.intersection(entities_b)
    union = entities_a.union(entities_b)
    if not union:
        return 0.0
    return len(intersection) / len(union)


def _time_decay(
    *,
    article_time: datetime | None,
    last_updated: datetime,
    half_life: float,
    floor: float,
    now: datetime | None,
) -> float:
    if half_life <= 0:
        return 1.0

    reference_now = now or datetime.now(timezone.utc)
    article_reference = article_time or reference_now
    last_updated_ref = last_updated

    if article_reference.tzinfo is None:
        article_reference = article_reference.replace(tzinfo=timezone.utc)
    if last_updated_ref.tzinfo is None:
        last_updated_ref = last_updated_ref.replace(tzinfo=timezone.utc)
    if reference_now.tzinfo is None:
        reference_now = reference_now.replace(tzinfo=timezone.utc)

    delta = article_reference - last_updated_ref
    hours = delta.total_seconds() / 3600.0
    if hours <= 0:
        return 1.0

    decay = math.pow(0.5, hours / half_life)
    if floor <= 0:
        return decay
    return max(floor, decay)


__all__ = [
    "ArticleFeatures",
    "EventFeatures",
    "ScoreParameters",
    "ScoreBreakdown",
    "compute_hybrid_score",
]
