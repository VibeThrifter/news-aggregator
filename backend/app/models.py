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
    scope_creep: Optional[str] = None
    composition_question: Optional[str] = None
    potential_interests: List[str] = Field(default_factory=list)
    critical_questions: List[str] = Field(default_factory=list)


class MediaAnalysis(BaseModel):
    source: str
    tone: str
    pattern: str
    questions_not_asked: List[str] = Field(default_factory=list)
    perspectives_omitted: List[str] = Field(default_factory=list)
    framing_by_omission: str


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
