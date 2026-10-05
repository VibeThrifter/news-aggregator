"""SQLAlchemy models for persistent storage."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from sqlalchemy import (
    JSON,
    REAL,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarative class."""


def utcnow() -> datetime:
    """Timezone-aware UTC timestamp for default values."""
    return datetime.now(timezone.utc)


# JSONB on PostgreSQL, plain JSON elsewhere (SQLite tests / local cache).
JSONBType = JSON().with_variant(JSONB(), "postgresql")
# TEXT[] on PostgreSQL (GIN-indexable, same type as migration 004), JSON list elsewhere.
AliasArrayType = JSON().with_variant(ARRAY(Text), "postgresql")
# INTEGER[] on PostgreSQL (event_entities.article_ids, migration 004), JSON list elsewhere.
ArticleIdArrayType = JSON().with_variant(ARRAY(Integer), "postgresql")


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
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
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
    # International perspectives (Epic 9)
    is_international: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_country: Mapped[str | None] = mapped_column(String(2), nullable=True)

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
    # International perspectives (Epic 9)
    detected_countries: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    international_enriched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
    # International perspectives (Epic 9)
    involved_countries: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    fallacies: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    frames: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    coverage_gaps: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    # Kritische analyse velden
    unsubstantiated_claims: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    authority_analysis: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    media_analysis: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    statistical_issues: Mapped[List[Dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    timing_analysis: Mapped[Dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    scientific_plurality: Mapped[Dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<LLMInsight event_id={self.event_id} provider={self.provider!r}>"


class NewsSource(Base):
    """Configuration for news sources with enabled/main source flags."""

    __tablename__ = "news_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    feed_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    spectrum: Mapped[str | None] = mapped_column(String(32), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_main_source: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<NewsSource source_id={self.source_id!r} enabled={self.enabled} is_main={self.is_main_source}>"


class ArticleBiasAnalysis(Base):
    """Per-sentence bias analysis results for individual articles (Epic 10)."""

    __tablename__ = "article_bias_analyses"
    __table_args__ = (
        UniqueConstraint("article_id", "provider", name="uq_article_bias_article_provider"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    article_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)

    # Sentence counts
    total_sentences: Mapped[int] = mapped_column(Integer, nullable=False)
    journalist_bias_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quote_bias_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Summary statistics (only for journalist biases - quotes don't count)
    journalist_bias_percentage: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    most_frequent_bias: Mapped[str | None] = mapped_column(String(64), nullable=True)
    most_frequent_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    average_bias_strength: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_rating: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Detailed results - separate arrays for journalist vs quote biases
    journalist_biases: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False)
    quote_biases: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<ArticleBiasAnalysis article_id={self.article_id} provider={self.provider!r} rating={self.overall_rating:.2f}>"


class LlmConfig(Base):
    """Configuration for LLM prompts and parameters, editable via admin dashboard."""

    __tablename__ = "llm_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    config_type: Mapped[str] = mapped_column(String(32), nullable=False)  # prompt, parameter, scoring
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<LlmConfig key={self.key!r} type={self.config_type!r}>"


class EventEntity(Base):
    """Canonical entities per event with counts (Epic 11, Story 11.8).

    Derived data: recomputed by the exploration service, never dual-written to the SQLite
    cache. Display fields (``event_*``) are denormalised so the frontend never has to embed
    ``events``; ``event_title`` is always the LLM title (copyright rule).
    """

    __tablename__ = "event_entities"
    __table_args__ = (
        UniqueConstraint("event_id", "entity_key", name="uq_event_entities_event_key"),
        CheckConstraint(
            "kind IN ('person','org','place','country','group','event')",
            name="ck_event_entities_kind",
        ),
        Index("idx_event_entities_event_id", "event_id"),
        Index("idx_event_entities_entity_key", "entity_key"),
        Index("idx_event_entities_aliases", "aliases", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE", name="fk_event_entities_event"),
        nullable=False,
    )
    entity_key: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    iso_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    aliases: Mapped[list[str]] = mapped_column(AliasArrayType, nullable=False, default=list)
    mention_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    article_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    outlet_counts: Mapped[dict[str, int]] = mapped_column(JSONBType, nullable=False, default=dict)
    # Ids of the event's (non-international) articles mentioning the entity: ascending, max 200.
    article_ids: Mapped[list[int]] = mapped_column(ArticleIdArrayType, nullable=False, default=list)
    salience: Mapped[float] = mapped_column(REAL, nullable=False, default=0.0)
    event_slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_title: Mapped[str] = mapped_column(String(512), nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    event_last_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<EventEntity event_id={self.event_id} key={self.entity_key!r}>"


Index(
    "idx_event_entities_recent",
    EventEntity.__table__.c.event_last_updated_at.desc(),
)


class EventRelation(Base):
    """Precomputed related events with reasons (Epic 11, Story 11.8).

    Rows are directional (``event_id`` -> ``related_event_id``) and stored for both
    directions. ``related_*`` display fields are denormalised; ``related_title`` is always the
    LLM title of the related event (copyright rule).
    """

    __tablename__ = "event_relations"
    __table_args__ = (
        UniqueConstraint("event_id", "related_event_id", name="uq_event_relations_pair"),
        CheckConstraint("event_id <> related_event_id", name="ck_event_relations_not_self"),
        CheckConstraint("score >= 0 AND score <= 1", name="ck_event_relations_score"),
        Index("idx_event_relations_related", "related_event_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE", name="fk_event_relations_event"),
        nullable=False,
    )
    related_event_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE", name="fk_event_relations_related"),
        nullable=False,
    )
    score: Mapped[float] = mapped_column(REAL, nullable=False)
    embedding_similarity: Mapped[float | None] = mapped_column(REAL, nullable=True)
    entity_overlap: Mapped[float | None] = mapped_column(REAL, nullable=True)
    country_overlap: Mapped[float | None] = mapped_column(REAL, nullable=True)
    reasons: Mapped[list[dict[str, Any]]] = mapped_column(JSONBType, nullable=False, default=list)
    related_slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    related_title: Mapped[str] = mapped_column(String(512), nullable=False)
    related_event_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    related_article_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    related_first_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    related_last_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return (
            f"<EventRelation event_id={self.event_id} related_event_id={self.related_event_id}"
            f" score={self.score:.2f}>"
        )


Index(
    "idx_event_relations_event_score",
    EventRelation.__table__.c.event_id,
    EventRelation.__table__.c.score.desc(),
)


# --------------------------------------------------------------------------------------
# Propagandamodel-koppeling (Epic 11, Story 11.17)
#
# A read-only copy of the approved propaganda-model graph, written by the sync service
# (full refresh). On Supabase these tables have RLS enabled WITHOUT policies and no grants for
# anon/authenticated: the frontend reaches them only through the SECURITY DEFINER RPC functions
# of migration 005 (one neighbourhood / search result / detail at a time).
# --------------------------------------------------------------------------------------

# TEXT[] on PostgreSQL (pm_relations.filters, migration 005), JSON list elsewhere.
PmTextArrayType = JSON().with_variant(ARRAY(Text), "postgresql")


class PmEntity(Base):
    """Approved propaganda-model entity (pm id as primary key)."""

    __tablename__ = "pm_entities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str | None] = mapped_column(Text, nullable=True)
    primary_filter: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_from: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_until: Mapped[str | None] = mapped_column(Text, nullable=True)
    degree: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Approved by the automatic news pipeline (pm account nieuws-autokeur, Epic 12)
    auto_approved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<PmEntity id={self.id} name={self.name!r}>"


class PmRelation(Base):
    """Approved propaganda-model relation (both endpoints are exported entities)."""

    __tablename__ = "pm_relations"
    __table_args__ = (
        Index("idx_pm_relations_source_id", "source_id"),
        Index("idx_pm_relations_target_id", "target_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    source_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("pm_entities.id", ondelete="CASCADE", name="fk_pm_relations_source"),
        nullable=False,
    )
    target_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("pm_entities.id", ondelete="CASCADE", name="fk_pm_relations_target"),
        nullable=False,
    )
    relation_type: Mapped[str] = mapped_column(Text, nullable=False)
    mechanism: Mapped[str | None] = mapped_column(Text, nullable=True)
    filter: Mapped[str | None] = mapped_column(Text, nullable=True)  # primary (edge colour)
    # primary filter UNION the mechanism's pm mechanism_filters tags; [] = none
    filters: Mapped[list[str]] = mapped_column(PmTextArrayType, nullable=False, default=list)
    aard: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    certainty_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_from: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_until: Mapped[str | None] = mapped_column(Text, nullable=True)
    bidirectional: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    source_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Approved by the automatic news pipeline (pm account nieuws-autokeur, Epic 12)
    auto_approved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<PmRelation id={self.id} {self.source_id}->{self.target_id}>"


class PmSource(Base):
    """Source supporting the existence of an exported entity or relation."""

    __tablename__ = "pm_sources"
    __table_args__ = (
        CheckConstraint("owner_kind IN ('entity','relation')", name="ck_pm_sources_owner_kind"),
        Index("idx_pm_sources_owner", "owner_kind", "owner_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_kind: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    publisher: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Evidence of an automatically approved element that no human has merged yet (Epic 12)
    unreviewed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<PmSource {self.owner_kind}:{self.owner_id} #{self.position}>"


class PmArgument(Base):
    """Argument for, against or nuancing an exported relation, with up to 3 sources (migration 010).

    ``aspect`` is what it is about (NULL = whether the relation exists), ``status`` its review
    status in the propaganda model (geverifieerd, ongecontroleerd, bronvermelding_nodig, betwist,
    verouderd; voorgesteld only for the unreviewed evidence of automatically approved relations).
    Replies point at their parent (``parent_id``).
    """

    __tablename__ = "pm_arguments"
    __table_args__ = (
        CheckConstraint("owner_kind IN ('entity','relation')", name="ck_pm_arguments_owner_kind"),
        CheckConstraint(
            "stance IN ('supporting','contradicting','contextual')", name="ck_pm_arguments_stance"
        ),
        Index("idx_pm_arguments_owner", "owner_kind", "owner_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    owner_kind: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aspect: Mapped[str | None] = mapped_column(Text, nullable=True)
    stance: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    claim: Mapped[str] = mapped_column(Text, nullable=False)
    # [{"title","url","publisher","published_at","kind","quote"}]
    sources: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONBType, nullable=False, default=list, server_default=text("'[]'")
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<PmArgument {self.id} {self.owner_kind}:{self.owner_id} {self.stance}>"


class PmMechanism(Base):
    """What a mechanism means, by its display name (= ``pm_relations.mechanism``, migration 010)."""

    __tablename__ = "pm_mechanisms"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    filter: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    effect: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<PmMechanism {self.name!r}>"


class PmAlias(Base):
    """Slug alias (shared ``slugify``) -> propaganda-model entity."""

    __tablename__ = "pm_aliases"
    __table_args__ = (Index("idx_pm_aliases_entity_id", "entity_id"),)

    alias: Mapped[str] = mapped_column(Text, primary_key=True)
    entity_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("pm_entities.id", ondelete="CASCADE", name="fk_pm_aliases_entity"),
        primary_key=True,
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<PmAlias {self.alias!r}->{self.entity_id}>"


class PmMeta(Base):
    """Key/value metadata of the last propaganda-model sync (version, synced_at, db_mtime, ...)."""

    __tablename__ = "pm_meta"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<PmMeta {self.key}={self.value!r}>"


# --------------------------------------------------------------------------------------
# Wie is dit? (Epic 12): research status per named entity
#
# One row per canonical key (person:<slug> | org:<slug> | actor:<slug>). Written by the local
# backend (triage, queue, status of the propaganda-model research agent) and by the RPC
# request_entity_research (a tap in the app). No direct anon access (RLS without policies,
# migration 006); the frontend reads through entity_research_status().
# --------------------------------------------------------------------------------------

ENTITY_RESEARCH_STATUSES: tuple[str, ...] = (
    "nieuw",
    "niet_nodig",
    "overgeslagen",
    "wachtrij",
    "bezig",
    "klaar",
    "niets_gevonden",
    "twijfel",
    "fout",
)
ENTITY_RESEARCH_ROLES: tuple[str, ...] = (
    "politicus",
    "journalist",
    "woordvoerder",
    "bestuurder",
    "organisatie",
    "expert",
    "overig",
    "prive",
    "onbekend",
)


class EntityResearch(Base):
    """Research status of a named entity against the propaganda model (Epic 12)."""

    __tablename__ = "entity_research"
    __table_args__ = (
        CheckConstraint("kind IN ('person','org','unknown')", name="ck_entity_research_kind"),
        CheckConstraint(
            "status IN (" + ",".join(f"'{s}'" for s in ENTITY_RESEARCH_STATUSES) + ")",
            name="ck_entity_research_status",
        ),
        CheckConstraint(
            "role_category IS NULL OR role_category IN ("
            + ",".join(f"'{r}'" for r in ENTITY_RESEARCH_ROLES)
            + ")",
            name="ck_entity_research_role",
        ),
        Index("idx_entity_research_status", "status", "priority"),
        Index("idx_entity_research_requested", "last_requested_at"),
    )

    entity_key: Mapped[str] = mapped_column(String(170), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unknown", server_default="unknown"
    )
    role_category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    role_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_foreign: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    priority: Mapped[float] = mapped_column(REAL, nullable=False, default=0.0, server_default="0")
    # {"articles": n, "outlets": n, "events": n, "mentions": n, "last_seen": iso}
    prominence: Mapped[dict[str, Any]] = mapped_column(
        JSONBType, nullable=False, default=dict, server_default=text("'{}'")
    )
    pm_entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pm_degree: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pm_doel_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="nieuw", server_default="nieuw"
    )
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Short report of the research agent (not exposed to the frontend)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # {"entities": n, "relations": n, "auto_approved": n, "pending": n}
    found: Mapped[dict[str, Any]] = mapped_column(
        JSONBType, nullable=False, default=dict, server_default=text("'{}'")
    )
    request_event_slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requested_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    triaged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    researched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<EntityResearch key={self.entity_key!r} status={self.status!r}>"


# --------------------------------------------------------------------------------------
# Dun bewijs (Epic 14, Story 14.13): evidence research for propaganda-model relations
# that readers see under "Wie zit erachter?" and that rest on thin evidence. One row per
# pm relation; demand comes from request_relation_research() (the event page), the local
# backend queues the relation in the propaganda model (nieuws_doelen, soort 'relatie') and
# pulls the outcome of its agent nieuws-bewijs. No direct anon access (RLS without
# policies, migration 011); the frontend reads through the functions of that migration.
# --------------------------------------------------------------------------------------

RELATION_RESEARCH_STATUSES: tuple[str, ...] = (
    "nieuw",
    "niet_nodig",
    "wachtrij",
    "bezig",
    "klaar",
    "niets_gevonden",
    "overgeslagen",
    "twijfel",
    "fout",
)


class RelationResearch(Base):
    """Evidence research status of one propaganda-model relation (Story 14.13)."""

    __tablename__ = "relation_research"
    __table_args__ = (
        CheckConstraint(
            "status IN (" + ",".join(f"'{s}'" for s in RELATION_RESEARCH_STATUSES) + ")",
            name="ck_relation_research_status",
        ),
        Index("idx_relation_research_status", "status", "priority"),
        Index("idx_relation_research_requested", "last_requested_at"),
    )

    relation_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="nieuw", server_default="nieuw"
    )
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[float] = mapped_column(REAL, nullable=False, default=0.0, server_default="0")
    # Event slugs the demand came from, newest first (at most 5)
    request_events: Mapped[list[str]] = mapped_column(
        JSONBType, nullable=False, default=list, server_default=text("'[]'")
    )
    requested_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    pm_doel_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # {"arguments": n, "sources": n, "pending": n, "merged": n, "rejected": n}
    found: Mapped[dict[str, Any]] = mapped_column(
        JSONBType, nullable=False, default=dict, server_default=text("'{}'")
    )
    # Report of the research agent for the reviewer (never exposed to the frontend)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    researched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<RelationResearch relation={self.relation_id} status={self.status!r}>"
