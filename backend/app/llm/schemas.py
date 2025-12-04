"""Pydantic schemas for LLM insight payloads."""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, HttpUrl

SpectrumLabel = Literal["mainstream", "links", "rechts", "alternatief", "overheid", "sociale_media"]
AuthorityType = Literal["overheidsinstantie", "expert", "organisatie", "bedrijf", "ngo", "internationaal"]
ClaimPresentation = Literal["feit", "advies", "mening", "voorspelling"]


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
    """Represents a framing technique used in news coverage (academic/NLP frames)."""

    frame_type: str = Field(
        ...,
        min_length=1,
        description="Frame type from: conflict, human_interest, economisch, moraliteit, verantwoordelijkheid, veiligheid, metafoor, eufemisme, hyperbool, strategisch"
    )
    technique: str = Field(
        default="",
        description="Specific technique used (e.g., the exact metaphor, euphemism, or strategic word choice)"
    )
    description: str = Field(..., min_length=1, description="How this frame/technique is applied and its effect on the reader")
    sources: List[HttpUrl] = Field(default_factory=list, description="Articles using this frame")
    spectrum: str = Field(..., min_length=1, description="Media spectrum of sources using this frame")


class CoverageGap(BaseModel):
    """Represents an underrepresented perspective or missing context in news coverage."""

    perspective: str = Field(..., min_length=1, description="Name/label of the missing perspective")
    description: str = Field(..., min_length=1, description="Explanation of what viewpoint or context is missing")
    relevance: str = Field(..., min_length=1, description="Why this perspective matters for understanding the event")
    potential_sources: List[str] = Field(default_factory=list, description="Types of sources that might provide this perspective")


# === NIEUWE KRITISCHE ANALYSE SECTIES ===


class UnsubstantiatedClaim(BaseModel):
    """Een claim die als feit wordt gepresenteerd zonder adequate onderbouwing."""

    claim: str = Field(..., min_length=1, description="De letterlijke claim uit het artikel")
    presented_as: str = Field(..., description="Hoe de claim wordt gepresenteerd: feit, advies, mening, voorspelling")
    source_in_article: str = Field(..., min_length=1, description="Wie maakt deze claim in het artikel")
    evidence_provided: str = Field(..., description="Welk bewijs wordt aangedragen (of 'geen')")
    missing_context: List[str] = Field(default_factory=list, description="Welke context ontbreekt")
    critical_questions: List[str] = Field(default_factory=list, description="Vragen die een kritische journalist zou stellen")


class AuthorityAnalysis(BaseModel):
    """Kritische analyse van een geciteerde autoriteit."""

    authority: str = Field(..., min_length=1, description="Naam van de autoriteit/organisatie")
    authority_type: str = Field(..., description="Type: overheidsinstantie, expert, organisatie, bedrijf, ngo, internationaal")
    claimed_expertise: str = Field(..., min_length=1, description="Op welk terrein claimen zij expertise")
    scope_creep: Optional[str] = Field(default=None, description="Treden zij buiten hun mandaat/expertise?")
    composition_question: Optional[str] = Field(default=None, description="Vragen over samenstelling/benoeming")
    potential_interests: List[str] = Field(default_factory=list, description="Mogelijke belangen die kunnen spelen")
    critical_questions: List[str] = Field(default_factory=list, description="Kritische vragen bij deze autoriteit")


class MediaAnalysis(BaseModel):
    """Kritische analyse van de berichtgeving zelf."""

    source: str = Field(..., min_length=1, description="Naam van het medium")
    tone: str = Field(..., min_length=1, description="Toon van berichtgeving: feitelijk, kritisch, sensationeel, etc.")
    pattern: str = Field(..., min_length=1, description="Waargenomen patroon in berichtgeving")
    questions_not_asked: List[str] = Field(default_factory=list, description="Relevante vragen die het artikel NIET stelt")
    perspectives_omitted: List[str] = Field(default_factory=list, description="Perspectieven die systematisch worden weggelaten")
    framing_by_omission: str = Field(..., min_length=1, description="Hoe weglating de berichtgeving framet")


class ScientificPlurality(BaseModel):
    """Analyse van wetenschappelijke pluraliteit bij claims met wetenschappelijke onderbouwing."""

    topic: str = Field(..., min_length=1, description="Het wetenschappelijke onderwerp")
    presented_view: str = Field(..., min_length=1, description="De gepresenteerde wetenschappelijke visie")
    alternative_views_mentioned: bool = Field(..., description="Worden alternatieve visies genoemd?")
    known_debates: List[str] = Field(default_factory=list, description="Bekende wetenschappelijke debatten over dit onderwerp")
    notable_dissenters: str = Field(default="", description="Bekende wetenschappers met afwijkende mening")
    assessment: str = Field(..., min_length=1, description="Beoordeling van de pluraliteit in de berichtgeving")


class InsightsPayload(BaseModel):
    summary: str = Field(..., min_length=100, description="Comprehensive narrative summary combining all articles")
    timeline: List[InsightTimelineItem] = Field(default_factory=list)
    clusters: List[InsightCluster] = Field(default_factory=list)
    contradictions: List[InsightContradiction] = Field(default_factory=list)
    fallacies: List[InsightFallacy] = Field(default_factory=list)
    frames: List[InsightFrame] = Field(default_factory=list, description="Framing perspectives used in news coverage")
    coverage_gaps: List[CoverageGap] = Field(default_factory=list, description="Underrepresented perspectives or missing contexts")
    # Nieuwe kritische analyse secties
    unsubstantiated_claims: List[UnsubstantiatedClaim] = Field(default_factory=list, description="Claims zonder adequate onderbouwing")
    authority_analysis: List[AuthorityAnalysis] = Field(default_factory=list, description="Kritische analyse van geciteerde autoriteiten")
    media_analysis: List[MediaAnalysis] = Field(default_factory=list, description="Kritische analyse van de berichtgeving zelf")
    scientific_plurality: Optional[ScientificPlurality] = Field(default=None, description="Analyse van wetenschappelijke pluraliteit")


__all__ = [
    "AuthorityAnalysis",
    "AuthorityType",
    "ClaimPresentation",
    "CoverageGap",
    "InsightCluster",
    "InsightClusterSource",
    "InsightContradiction",
    "InsightContradictionClaim",
    "InsightFallacy",
    "InsightFrame",
    "InsightTimelineItem",
    "InsightsPayload",
    "MediaAnalysis",
    "ScientificPlurality",
    "SpectrumLabel",
    "UnsubstantiatedClaim",
]
