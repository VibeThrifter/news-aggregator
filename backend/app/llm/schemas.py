"""Pydantic schemas for LLM insight payloads."""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field, HttpUrl

SpectrumLabel = Literal["mainstream", "links", "rechts", "alternatief", "overheid", "sociale_media"]


class InsightTimelineItem(BaseModel):
    time: datetime = Field(..., description="Event moment timestamp (ISO-8601)")
    headline: str = Field(..., min_length=1)
    sources: List[HttpUrl] = Field(default_factory=list)
    spectrum: SpectrumLabel


class InsightClusterSource(BaseModel):
    title: str = Field(..., min_length=1)
    url: HttpUrl
    spectrum: str = Field(..., min_length=1)
    stance: str = Field(default="", description="Short stance description")


class InsightCluster(BaseModel):
    label: str = Field(..., min_length=1)
    spectrum: SpectrumLabel
    source_types: List[str] = Field(default_factory=list)
    summary: str = Field(..., min_length=1)
    characteristics: List[str] = Field(default_factory=list)
    sources: List[InsightClusterSource] = Field(default_factory=list)


class InsightContradictionClaim(BaseModel):
    summary: str = Field(..., min_length=1)
    sources: List[HttpUrl] = Field(default_factory=list)
    spectrum: str = Field(..., min_length=1)


class InsightContradiction(BaseModel):
    topic: str = Field(..., min_length=1)
    claim_a: InsightContradictionClaim
    claim_b: InsightContradictionClaim
    verification: Literal["onbevestigd", "bevestigd", "tegengesproken"]


class InsightFallacy(BaseModel):
    type: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    sources: List[HttpUrl] = Field(default_factory=list)
    spectrum: str = Field(..., min_length=1)


class InsightFrame(BaseModel):
    """Represents a framing perspective used in news coverage."""

    frame_type: str = Field(..., min_length=1, description="Type of framing (e.g., 'conflict', 'human interest', 'economic', 'morality')")
    description: str = Field(..., min_length=1, description="How this frame is applied in the reporting")
    sources: List[HttpUrl] = Field(default_factory=list, description="Articles using this frame")
    spectrum: str = Field(..., min_length=1, description="Media spectrum of sources using this frame")


class CoverageGap(BaseModel):
    """Represents an underrepresented perspective or missing context in news coverage."""

    perspective: str = Field(..., min_length=1, description="Name/label of the missing perspective")
    description: str = Field(..., min_length=1, description="Explanation of what viewpoint or context is missing")
    relevance: str = Field(..., min_length=1, description="Why this perspective matters for understanding the event")
    potential_sources: List[str] = Field(default_factory=list, description="Types of sources that might provide this perspective")


class InsightsPayload(BaseModel):
    summary: str = Field(..., min_length=100, description="Comprehensive narrative summary combining all articles")
    timeline: List[InsightTimelineItem] = Field(default_factory=list)
    clusters: List[InsightCluster] = Field(default_factory=list)
    contradictions: List[InsightContradiction] = Field(default_factory=list)
    fallacies: List[InsightFallacy] = Field(default_factory=list)
    frames: List[InsightFrame] = Field(default_factory=list, description="Framing perspectives used in news coverage")
    coverage_gaps: List[CoverageGap] = Field(default_factory=list, description="Underrepresented perspectives or missing contexts")


__all__ = [
    "CoverageGap",
    "InsightCluster",
    "InsightClusterSource",
    "InsightContradiction",
    "InsightContradictionClaim",
    "InsightFallacy",
    "InsightFrame",
    "InsightTimelineItem",
    "InsightsPayload",
    "SpectrumLabel",
]
