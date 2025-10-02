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


class InsightsPayload(BaseModel):
    timeline: List[InsightTimelineItem] = Field(default_factory=list)
    clusters: List[InsightCluster] = Field(default_factory=list)
    contradictions: List[InsightContradiction] = Field(default_factory=list)
    fallacies: List[InsightFallacy] = Field(default_factory=list)


__all__ = [
    "InsightCluster",
    "InsightClusterSource",
    "InsightContradiction",
    "InsightContradictionClaim",
    "InsightFallacy",
    "InsightTimelineItem",
    "InsightsPayload",
    "SpectrumLabel",
]
