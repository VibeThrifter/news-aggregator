from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class TavilyArticle(BaseModel):
    title: str
    url: HttpUrl
    snippet: Optional[str] = None
    published_time: Optional[datetime] = None


class Article(BaseModel):
    title: str
    url: HttpUrl
    text: str = Field(..., description="Extracted article text")
    snippet: Optional[str] = None
    published_time: Optional[datetime] = None


class TimelineEvent(BaseModel):
    time: str
    headline: str
    sources: List[str]
    spectrum: Optional[str] = None


class ClusterSource(BaseModel):
    title: str
    url: str  # Changed from HttpUrl to str to avoid validation issues
    spectrum: Optional[str] = None
    stance: Optional[str] = None


class Cluster(BaseModel):
    label: str
    spectrum: Optional[str] = None
    source_types: Optional[List[str]] = None
    summary: str
    characteristics: Optional[List[str]] = None
    sources: List[ClusterSource]


class Fallacy(BaseModel):
    type: str
    description: str
    sources: List[str]
    spectrum: Optional[str] = None


class Frame(BaseModel):
    frame_type: str
    description: str
    sources: List[str]
    spectrum: Optional[str] = None


class ContradictionClaim(BaseModel):
    summary: str
    sources: List[str]
    spectrum: Optional[str] = None


class Contradiction(BaseModel):
    topic: str
    claim_a: ContradictionClaim
    claim_b: ContradictionClaim
    verification: str

    model_config = ConfigDict(populate_by_name=True)


class CoverageGap(BaseModel):
    perspective: str
    description: str
    relevance: str
    potential_sources: List[str]


# Kritische analyse types
class UnsubstantiatedClaim(BaseModel):
    claim: str
    presented_as: str
    source_in_article: str
    evidence_provided: str
    missing_context: List[str] = Field(default_factory=list)
    critical_questions: List[str] = Field(default_factory=list)


class AuthorityAnalysis(BaseModel):
    authority: str
    authority_type: str
    claimed_expertise: str
    actual_role: Optional[str] = None
    scope_creep: Optional[str] = None
    composition_question: Optional[str] = None
    funding_sources: Optional[str] = None
    track_record: Optional[str] = None
    potential_interests: List[str] = Field(default_factory=list)
    independence_check: Optional[str] = None
    critical_questions: List[str] = Field(default_factory=list)


class MediaAnalysis(BaseModel):
    source: str
    tone: str
    sourcing_pattern: Optional[str] = None
    questions_not_asked: List[str] = Field(default_factory=list)
    perspectives_omitted: List[str] = Field(default_factory=list)
    framing_by_omission: Optional[str] = None
    copy_paste_score: Optional[str] = None
    anonymous_source_count: Optional[int] = None
    narrative_alignment: Optional[str] = None
    what_if_wrong: Optional[str] = None


class StatisticalIssue(BaseModel):
    claim: str
    issue: str
    better_framing: Optional[str] = None


class TimingAnalysis(BaseModel):
    why_now: str
    cui_bono: Optional[str] = None
    upcoming_events: Optional[str] = None


class ScientificPlurality(BaseModel):
    topic: str
    presented_view: str
    alternative_views_mentioned: bool
    known_debates: List[str] = Field(default_factory=list)
    notable_dissenters: str
    assessment: str


class AggregationResponse(BaseModel):
    query: str
    generated_at: datetime
    llm_provider: Optional[str] = None
    summary: Optional[str] = None
    timeline: List[TimelineEvent]
    clusters: List[Cluster]
    fallacies: List[Fallacy]
    frames: List[Frame]
    contradictions: List[Contradiction]
    coverage_gaps: List[CoverageGap] = Field(default_factory=list)
    # Kritische analyse
    unsubstantiated_claims: List[UnsubstantiatedClaim] = Field(default_factory=list)
    authority_analysis: List[AuthorityAnalysis] = Field(default_factory=list)
    media_analysis: List[MediaAnalysis] = Field(default_factory=list)
    statistical_issues: List[StatisticalIssue] = Field(default_factory=list)
    timing_analysis: Optional[TimingAnalysis] = None
    scientific_plurality: Optional[ScientificPlurality] = None


class AggregateRequest(BaseModel):
    query: str
    max_results: Optional[int] = Field(default=None, ge=1, le=20)


# REST API Response Models for Events and Insights

class EventSourceBreakdownEntry(BaseModel):
    source: str
    article_count: int
    spectrum: Optional[str] = None


class EventArticleResponse(BaseModel):
    id: int
    title: str
    url: str
    source: str
    spectrum: Optional[str] = None
    published_at: Optional[datetime] = None
    summary: Optional[str] = None
    image_url: Optional[str] = None


class EventListItem(BaseModel):
    id: int
    slug: Optional[str] = None
    title: str
    description: Optional[str] = None
    summary: Optional[str] = None
    first_seen_at: Optional[datetime] = None
    last_updated_at: Optional[datetime] = None
    article_count: int
    spectrum_distribution: Optional[dict] = None
    source_breakdown: Optional[List[EventSourceBreakdownEntry]] = None
    llm_provider: Optional[str] = None
    featured_image_url: Optional[str] = None


class EventDetail(EventListItem):
    articles: Optional[List[EventArticleResponse]] = None
    insights_status: Optional[str] = None
    insights_generated_at: Optional[datetime] = None
    insights_requested_at: Optional[datetime] = None
    keywords: Optional[List[str]] = None


class EventFeedMeta(BaseModel):
    last_updated_at: Optional[datetime] = None
    last_updated: Optional[datetime] = None
    last_refresh_at: Optional[datetime] = None
    generated_at: Optional[datetime] = None
    llm_provider: Optional[str] = None
    active_provider: Optional[str] = None
    total_events: Optional[int] = None
    event_count: Optional[int] = None


class EventDetailMeta(BaseModel):
    last_updated_at: Optional[datetime] = None
    generated_at: Optional[datetime] = None
    llm_provider: Optional[str] = None
    insights_status: Optional[str] = None
    insights_generated_at: Optional[datetime] = None
    insights_requested_at: Optional[datetime] = None
    first_seen_at: Optional[datetime] = None


class ApiResponse(BaseModel):
    data: List[EventListItem] | EventDetail | AggregationResponse
    meta: Optional[EventFeedMeta | EventDetailMeta | dict] = None
    links: Optional[dict] = None


# Bias Analysis Response Models (Epic 10)


class SentenceBiasResponse(BaseModel):
    """A single sentence with detected bias."""

    sentence_index: int
    sentence_text: str
    bias_type: str
    bias_source: str  # "journalist", "framing", "quote_selection", or "quote"
    speaker: Optional[str] = None  # Only for quote bias
    score: float = Field(..., ge=0.0, le=1.0)
    explanation: str


class BiasAnalysisSummary(BaseModel):
    """Summary statistics for bias analysis."""

    total_sentences: int
    journalist_bias_count: int
    quote_bias_count: int
    journalist_bias_percentage: float
    most_frequent_journalist_bias: Optional[str] = None
    most_frequent_count: Optional[int] = None
    average_journalist_bias_strength: Optional[float] = None
    overall_journalist_rating: float = Field(
        ..., ge=0.0, le=1.0, description="Lower = more objective"
    )


class ArticleBiasResponse(BaseModel):
    """Full bias analysis response for a single article."""

    article_id: int
    analyzed_at: datetime
    provider: str
    model: str
    summary: BiasAnalysisSummary
    journalist_biases: List[SentenceBiasResponse]
    quote_biases: List[SentenceBiasResponse]


class ArticleBiasResponseMeta(BaseModel):
    """Metadata for article bias response."""

    article_id: int
    provider: str
    model: str
    analyzed_at: datetime


class SourceBiasStats(BaseModel):
    """Bias statistics for a single source within an event."""

    source: str
    article_count: int
    average_rating: float = Field(
        ..., ge=0.0, le=1.0, description="Average overall_journalist_rating"
    )
    articles_analyzed: int
    total_journalist_biases: int


class BiasTypeCount(BaseModel):
    """Count of a specific bias type across event."""

    bias_type: str
    count: int


class EventBiasSummary(BaseModel):
    """Aggregated bias summary for an event."""

    event_id: int
    total_articles: int
    articles_analyzed: int
    average_bias_rating: Optional[float] = Field(
        None, ge=0.0, le=1.0, description="Average across all analyzed articles"
    )
    by_source: List[SourceBiasStats]
    bias_type_distribution: List[BiasTypeCount]


class EventBiasSummaryMeta(BaseModel):
    """Metadata for event bias summary."""

    event_id: int
    generated_at: datetime
    total_articles: int
    articles_analyzed: int
