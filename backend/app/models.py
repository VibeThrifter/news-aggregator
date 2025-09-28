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
    event: str


class ClusterSource(BaseModel):
    title: str
    url: HttpUrl


class Cluster(BaseModel):
    angle: str
    summary: str
    sources: List[ClusterSource]


class Fallacy(BaseModel):
    type: str
    claim: str
    explanation: str
    sources: List[ClusterSource]


class Contradiction(BaseModel):
    topic: str
    claim_a: str = Field(alias="claim_A")
    claim_b: str = Field(alias="claim_B")
    status: str
    source_a: Optional[ClusterSource] = Field(default=None, alias="source_A")
    source_b: Optional[ClusterSource] = Field(default=None, alias="source_B")

    model_config = ConfigDict(populate_by_name=True)


class AggregationResponse(BaseModel):
    query: str
    generated_at: datetime
    llm_provider: Optional[str] = None
    timeline: List[TimelineEvent]
    clusters: List[Cluster]
    fallacies: List[Fallacy]
    contradictions: List[Contradiction]


class AggregateRequest(BaseModel):
    query: str
    max_results: Optional[int] = Field(default=None, ge=1, le=20)
