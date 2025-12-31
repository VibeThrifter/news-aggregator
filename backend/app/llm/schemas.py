"""Pydantic schemas for LLM insight payloads."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

SpectrumLabel = Literal["mainstream", "links", "rechts", "alternatief", "overheid", "sociale_media"]
ClaimPresentation = Literal["feit", "advies", "mening", "voorspelling"]


class InvolvedCountry(BaseModel):
    """A country involved in the news event, detected by LLM analysis."""

    iso_code: str = Field(
        ...,
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code (e.g., 'US', 'IL', 'RU')"
    )
    name: str = Field(..., min_length=1, description="Full country name in English")
    relevance: str = Field(
        ...,
        min_length=1,
        description="Brief explanation of how this country is involved"
    )


class InsightTimelineItem(BaseModel):
    time: str = Field(..., description="Event moment: year (1934), date (2025-12-28), or ISO-8601 datetime")
    headline: str = Field(..., min_length=1)
    sources: list[HttpUrl] = Field(default_factory=list)
    spectrum: SpectrumLabel


class InsightClusterSource(BaseModel):
    title: str = Field(..., min_length=1)
    url: HttpUrl
    spectrum: str = Field(..., min_length=1)
    stance: str = Field(default="", description="Short stance description")


class InsightCluster(BaseModel):
    label: str = Field(..., min_length=1)
    spectrum: SpectrumLabel
    source_types: list[str] = Field(default_factory=list)
    summary: str = Field(..., min_length=1)
    characteristics: list[str] = Field(default_factory=list)
    sources: list[InsightClusterSource] = Field(default_factory=list)


class InsightContradictionClaim(BaseModel):
    summary: str = Field(..., min_length=1)
    sources: list[HttpUrl] = Field(default_factory=list)
    spectrum: str = Field(..., min_length=1)


class InsightContradiction(BaseModel):
    topic: str = Field(..., min_length=1)
    claim_a: InsightContradictionClaim
    claim_b: InsightContradictionClaim
    verification: Literal["onbevestigd", "bevestigd", "tegengesproken"]


class InsightFallacy(BaseModel):
    type: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    sources: list[HttpUrl] = Field(default_factory=list)
    spectrum: str = Field(..., min_length=1)


FrameAttribution = Literal["eigen_framing", "geciteerd"]


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
    sources: list[HttpUrl] = Field(default_factory=list, description="Articles using this frame - ONLY sources that use this framing themselves, not sources that quote others using it")
    spectrum: str = Field(..., min_length=1, description="Media spectrum of sources using this frame")
    attribution: FrameAttribution | None = Field(
        default=None,
        description="eigen_framing = media outlet uses this framing itself; geciteerd = media is reporting what others say"
    )


class CoverageGap(BaseModel):
    """Represents an underrepresented perspective or missing context in news coverage."""

    perspective: str = Field(..., min_length=1, description="Name/label of the missing perspective")
    description: str = Field(..., min_length=1, description="Explanation of what viewpoint or context is missing")
    relevance: str = Field(..., min_length=1, description="Why this perspective matters for understanding the event")
    potential_sources: list[str] = Field(default_factory=list, description="Types of sources that might provide this perspective")


# === NIEUWE KRITISCHE ANALYSE SECTIES ===


class UnsubstantiatedClaim(BaseModel):
    """Een claim die als feit wordt gepresenteerd zonder adequate onderbouwing."""

    claim: str = Field(..., min_length=1, description="De letterlijke claim uit het artikel")
    presented_as: str = Field(..., description="Hoe de claim wordt gepresenteerd: feit, advies, mening, voorspelling")
    source_in_article: str = Field(..., min_length=1, description="Wie maakt deze claim in het artikel")
    article_url: HttpUrl | None = Field(default=None, description="URL van het artikel waarin deze claim voorkomt")
    evidence_provided: str = Field(..., description="Welk bewijs wordt aangedragen (of 'geen')")
    missing_context: list[str] = Field(default_factory=list, description="Welke context ontbreekt")
    critical_questions: list[str] = Field(default_factory=list, description="Vragen die een kritische journalist zou stellen")


class AuthorityAnalysis(BaseModel):
    """Kritische analyse van een geciteerde autoriteit."""

    authority: str = Field(..., min_length=1, description="Naam van de autoriteit/organisatie")
    authority_type: str = Field(..., description="Beschrijf accuraat - vermijd generieke labels")
    article_url: HttpUrl | None = Field(default=None, description="URL van het artikel waarin deze autoriteit wordt geciteerd")
    claimed_expertise: str = Field(..., min_length=1, description="Op welk terrein claimen zij expertise")
    actual_role: str = Field(default="", description="Wat doen/zijn ze daadwerkelijk")
    scope_creep: str = Field(default="", description="Adviseert buiten mandaat? Bijv. gezondheidsexpert over economie")
    composition_question: str = Field(default="", description="Voor adviesorganen: wie benoemt leden? Welke achtergronden en standpunten zijn vertegenwoordigd? Is er ideologische diversiteit?")
    funding_sources: str = Field(default="", description="Wie financiert dit instituut/deze expert?")
    track_record: str = Field(default="", description="Eerdere uitspraken/adviezen en hoe die uitpakten")
    potential_interests: list[str] = Field(default_factory=list, description="Financiële, politieke, reputationele belangen")
    independence_check: str = Field(default="", description="Onafhankelijk van wie? Gefinancierd door wie?")
    critical_questions: list[str] = Field(default_factory=list, description="Sceptische vragen bij deze autoriteit")

    @model_validator(mode="before")
    @classmethod
    def convert_nulls_to_empty_strings(cls, data: dict) -> dict:
        """Convert null values to empty strings for optional string fields."""
        if isinstance(data, dict):
            nullable_fields = [
                "actual_role", "scope_creep", "composition_question",
                "funding_sources", "track_record", "independence_check"
            ]
            for field in nullable_fields:
                if field in data and data[field] is None:
                    data[field] = ""
        return data


class MediaAnalysis(BaseModel):
    """Kritische analyse van de berichtgeving zelf."""

    source: str = Field(..., min_length=1, description="Naam van het medium")
    article_url: HttpUrl | None = Field(default=None, description="URL van het specifieke artikel dat wordt geanalyseerd")
    tone: str = Field(..., min_length=1, description="Toon: feitelijk, kritisch, sensationeel, alarmerend, geruststellend, activistisch")
    sourcing_pattern: str = Field(default="", description="Wie citeren ze? Wie niet?")
    questions_not_asked: list[str] = Field(default_factory=list, description="Belangrijke vragen die de journalist niet stelde")
    perspectives_omitted: list[str] = Field(default_factory=list, description="Weggelaten perspectieven")
    framing_by_omission: str = Field(default="", description="Hoe weglating de framing beïnvloedt")
    copy_paste_score: str = Field(default="", description="Mate van kopie van persberichten/andere media (hoog/middel/laag)")
    anonymous_source_count: int = Field(default=0, description="Aantal anonieme bronnen in dit artikel")
    narrative_alignment: str = Field(default="", description="Past dit bij een bepaald narratief of agenda?")
    what_if_wrong: str = Field(default="", description="Wat zijn de gevolgen als hun framing fout is?")

    @model_validator(mode="before")
    @classmethod
    def convert_nulls_to_empty_strings(cls, data: dict) -> dict:
        """Convert null values to empty strings for optional string fields."""
        if isinstance(data, dict):
            nullable_fields = [
                "sourcing_pattern", "framing_by_omission", "copy_paste_score",
                "narrative_alignment", "what_if_wrong"
            ]
            for field in nullable_fields:
                if field in data and data[field] is None:
                    data[field] = ""
            # Handle anonymous_source_count being null
            if "anonymous_source_count" in data and data["anonymous_source_count"] is None:
                data["anonymous_source_count"] = 0
        return data


class ScientificPlurality(BaseModel):
    """Analyse van wetenschappelijke pluraliteit bij claims met wetenschappelijke onderbouwing."""

    topic: str = Field(..., min_length=1, description="Het wetenschappelijke onderwerp")
    presented_view: str = Field(..., min_length=1, description="De gepresenteerde wetenschappelijke visie")
    alternative_views_mentioned: bool = Field(..., description="Worden alternatieve visies genoemd?")
    known_debates: list[str] = Field(default_factory=list, description="Bekende wetenschappelijke debatten over dit onderwerp")
    notable_dissenters: str = Field(default="", description="Bekende wetenschappers met afwijkende mening")
    assessment: str = Field(..., min_length=1, description="Beoordeling van de pluraliteit in de berichtgeving")

    @model_validator(mode="before")
    @classmethod
    def convert_nulls(cls, data: dict) -> dict:
        """Convert null values to appropriate defaults."""
        if isinstance(data, dict):
            if "notable_dissenters" in data and data["notable_dissenters"] is None:
                data["notable_dissenters"] = ""
        return data


class StatisticalIssue(BaseModel):
    """Een misleidende of onjuist gepresenteerde statistiek."""

    claim: str = Field(..., min_length=1, description="De statistische claim uit het artikel")
    article_url: HttpUrl | None = Field(default=None, description="URL van het artikel met deze statistiek")
    issue: str = Field(..., min_length=1, description="Wat er misleidend aan is")
    better_framing: str = Field(default="", description="Hoe het beter gepresenteerd zou kunnen worden")

    @model_validator(mode="before")
    @classmethod
    def convert_nulls(cls, data: dict) -> dict:
        """Convert null values to appropriate defaults."""
        if isinstance(data, dict):
            if "better_framing" in data and data["better_framing"] is None:
                data["better_framing"] = ""
        return data


class TimingAnalysis(BaseModel):
    """Analyse van de timing van het nieuwsbericht."""

    why_now: str = Field(..., min_length=1, description="Waarom is dit nu nieuws?")
    cui_bono: str = Field(default="", description="Wie profiteert van deze timing?")
    upcoming_events: str = Field(default="", description="Relevante aankomende beslissingen of gebeurtenissen")

    @model_validator(mode="before")
    @classmethod
    def convert_nulls(cls, data: dict) -> dict:
        """Convert null values to appropriate defaults."""
        if isinstance(data, dict):
            nullable_fields = ["cui_bono", "upcoming_events"]
            for field in nullable_fields:
                if field in data and data[field] is None:
                    data[field] = ""
        return data


class KeywordExtractionPayload(BaseModel):
    """Lightweight payload for keyword extraction phase (pre-enrichment)."""

    search_keywords: list[str] = Field(
        default_factory=list,
        max_length=5,
        description="3-5 English keywords for searching international news about this event"
    )
    involved_countries: list[InvolvedCountry] = Field(
        default_factory=list,
        description="Countries involved in this news event (excluding NL/BE)"
    )


class FactualPayload(BaseModel):
    """Phase 1: Factual analysis only."""

    summary: str = Field(..., min_length=100, description="Comprehensive narrative summary combining all articles")
    timeline: list[InsightTimelineItem] = Field(default_factory=list)
    clusters: list[InsightCluster] = Field(default_factory=list)
    contradictions: list[InsightContradiction] = Field(default_factory=list)
    involved_countries: list[InvolvedCountry] = Field(
        default_factory=list,
        description="Countries involved in this news event (excluding NL/BE)"
    )
    search_keywords: list[str] = Field(
        default_factory=list,
        max_length=5,
        description="3-5 English keywords for searching international news about this event (e.g., names, places, key terms)"
    )


class CriticalPayload(BaseModel):
    """Phase 2: Critical analysis only."""

    fallacies: list[InsightFallacy] = Field(default_factory=list)
    frames: list[InsightFrame] = Field(default_factory=list, description="Framing perspectives used in news coverage")
    coverage_gaps: list[CoverageGap] = Field(default_factory=list, description="Underrepresented perspectives or missing contexts")
    unsubstantiated_claims: list[UnsubstantiatedClaim] = Field(default_factory=list, description="Claims zonder adequate onderbouwing")
    authority_analysis: list[AuthorityAnalysis] = Field(default_factory=list, description="Kritische analyse van geciteerde autoriteiten")
    media_analysis: list[MediaAnalysis] = Field(default_factory=list, description="Kritische analyse van de berichtgeving zelf")
    statistical_issues: list[StatisticalIssue] = Field(default_factory=list, description="Misleidende statistieken")
    timing_analysis: TimingAnalysis | None = Field(default=None, description="Analyse van de timing van het nieuwsbericht")
    scientific_plurality: ScientificPlurality | None = Field(default=None, description="Analyse van wetenschappelijke pluraliteit")

    @field_validator("statistical_issues", mode="before")
    @classmethod
    def coerce_statistical_issues(cls, v: list | None) -> list:
        """Convert null to empty list for statistical_issues."""
        return v if v is not None else []


class InsightsPayload(BaseModel):
    summary: str = Field(..., min_length=100, description="Comprehensive narrative summary combining all articles")
    timeline: list[InsightTimelineItem] = Field(default_factory=list)
    clusters: list[InsightCluster] = Field(default_factory=list)
    contradictions: list[InsightContradiction] = Field(default_factory=list)
    involved_countries: list[InvolvedCountry] = Field(
        default_factory=list,
        description="Countries involved in this news event (excluding NL/BE)"
    )
    search_keywords: list[str] = Field(
        default_factory=list,
        description="English keywords for international news search"
    )
    fallacies: list[InsightFallacy] = Field(default_factory=list)
    frames: list[InsightFrame] = Field(default_factory=list, description="Framing perspectives used in news coverage")
    coverage_gaps: list[CoverageGap] = Field(default_factory=list, description="Underrepresented perspectives or missing contexts")
    # Kritische analyse secties
    unsubstantiated_claims: list[UnsubstantiatedClaim] = Field(default_factory=list, description="Claims zonder adequate onderbouwing")
    authority_analysis: list[AuthorityAnalysis] = Field(default_factory=list, description="Kritische analyse van geciteerde autoriteiten")
    media_analysis: list[MediaAnalysis] = Field(default_factory=list, description="Kritische analyse van de berichtgeving zelf")
    statistical_issues: list[StatisticalIssue] = Field(default_factory=list, description="Misleidende statistieken")
    timing_analysis: TimingAnalysis | None = Field(default=None, description="Analyse van de timing van het nieuwsbericht")
    scientific_plurality: ScientificPlurality | None = Field(default=None, description="Analyse van wetenschappelijke pluraliteit")

    @classmethod
    def from_phases(cls, factual: FactualPayload, critical: CriticalPayload) -> InsightsPayload:
        """Merge factual and critical payloads into a complete InsightsPayload."""
        return cls(
            summary=factual.summary,
            timeline=factual.timeline,
            clusters=factual.clusters,
            contradictions=factual.contradictions,
            involved_countries=factual.involved_countries,
            search_keywords=factual.search_keywords,
            fallacies=critical.fallacies,
            frames=critical.frames,
            coverage_gaps=critical.coverage_gaps,
            unsubstantiated_claims=critical.unsubstantiated_claims,
            authority_analysis=critical.authority_analysis,
            media_analysis=critical.media_analysis,
            statistical_issues=critical.statistical_issues,
            timing_analysis=critical.timing_analysis,
            scientific_plurality=critical.scientific_plurality,
        )


__all__ = [
    "AuthorityAnalysis",
    "ClaimPresentation",
    "CoverageGap",
    "CriticalPayload",
    "FactualPayload",
    "FrameAttribution",
    "InsightCluster",
    "InsightClusterSource",
    "InsightContradiction",
    "InsightContradictionClaim",
    "InsightFallacy",
    "InsightFrame",
    "InsightTimelineItem",
    "InsightsPayload",
    "InvolvedCountry",
    "KeywordExtractionPayload",
    "MediaAnalysis",
    "ScientificPlurality",
    "SpectrumLabel",
    "StatisticalIssue",
    "TimingAnalysis",
    "UnsubstantiatedClaim",
]
