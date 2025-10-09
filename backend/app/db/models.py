"""SQLAlchemy models for persistent storage."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarative class."""


def utcnow() -> datetime:
    """Timezone-aware UTC timestamp for default values."""
    return datetime.now(timezone.utc)


class Article(Base):
    """Persisted article content fetched from feeds."""

    __tablename__ = "articles"
    __table_args__ = (
        UniqueConstraint("url", name="uq_articles_url"),
        UniqueConstraint("guid", name="uq_articles_guid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guid: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_metadata: Mapped[Dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    normalized_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized_tokens: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    tfidf_vector: Mapped[Dict[str, float] | None] = mapped_column(JSON, nullable=True)
    entities: Mapped[list[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    # Enhanced entity extraction for better clustering
    extracted_dates: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    extracted_locations: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    enriched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<Article id={self.id} url={self.url!r}>"


class Event(Base):
    """Persisted event clusters built from related articles."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    centroid_embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    centroid_tfidf: Mapped[Dict[str, float] | None] = mapped_column(JSON, nullable=True)
    centroid_entities: Mapped[list[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    last_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    article_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    spectrum_distribution: Mapped[Dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<Event id={self.id} title={self.title!r}>"


class EventArticle(Base):
    """Link table between events and articles with scoring metadata."""

    __tablename__ = "event_articles"
    __table_args__ = (
        UniqueConstraint("event_id", "article_id", name="uq_event_articles_event_article"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    article_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
    )
    similarity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    scoring_breakdown: Mapped[Dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<EventArticle event_id={self.event_id} article_id={self.article_id}>"


class LLMInsight(Base):
    """LLM-generated insights attached to an event."""

    __tablename__ = "llm_insights"
    __table_args__ = (
        UniqueConstraint("event_id", "provider", name="uq_llm_insights_event_provider"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt_metadata: Mapped[Dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeline: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    clusters: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    contradictions: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    fallacies: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    frames: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    coverage_gaps: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<LLMInsight event_id={self.event_id} provider={self.provider!r}>"
