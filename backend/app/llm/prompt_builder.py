"""Prompt builder for pluriform LLM insights (Story 3.1)."""

from __future__ import annotations

import re
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from importlib import resources
from textwrap import shorten
from typing import List, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.dual_write import get_read_session
from backend.app.db.models import Article, Event, EventArticle
from backend.app.db.session import get_sessionmaker
from backend.app.services.llm_config_service import get_llm_config_service

LOG = get_logger(__name__).bind(component="PromptBuilder")
SENTENCE_PATTERN = re.compile(r"(?<=[.!?])\s+")
SPECTRUM_FALLBACK = "onbekend"
ARTICLE_CAPSULE_SENTENCE_LIMIT = 3
DEFAULT_SUMMARY_CHAR_LIMIT = 320


def _load_template(filename: str = "pluriform_prompt.txt") -> str:
    """Load a prompt template from package resources."""
    template_path = resources.files("backend.app.llm.templates").joinpath(filename)
    return template_path.read_text(encoding="utf-8")


# File-based templates as fallbacks
_FILE_PROMPT_TEMPLATE = _load_template("pluriform_prompt.txt")
_FILE_FACTUAL_TEMPLATE = _load_template("factual_prompt.txt")
_FILE_CRITICAL_TEMPLATE = _load_template("critical_prompt.txt")
_FILE_KEYWORD_TEMPLATE = _load_template("keyword_extraction_prompt.txt")

# Legacy aliases for backwards compatibility
PROMPT_TEMPLATE = _FILE_PROMPT_TEMPLATE
FACTUAL_TEMPLATE = _FILE_FACTUAL_TEMPLATE
CRITICAL_TEMPLATE = _FILE_CRITICAL_TEMPLATE
KEYWORD_TEMPLATE = _FILE_KEYWORD_TEMPLATE


async def _get_prompt_from_db(key: str, fallback: str) -> str:
    """Load prompt from database, falling back to file-based template."""
    try:
        config_service = get_llm_config_service()
        db_value = await config_service.get_value(f"prompt_{key}")
        if db_value and db_value.strip():
            return db_value
    except Exception as e:
        LOG.warning("prompt_db_load_failed", key=key, error=str(e))
    return fallback


@dataclass(slots=True)
class PromptGenerationResult:
    """Bundle returned by the prompt builder with metadata."""

    prompt: str
    prompt_length: int
    selected_article_ids: List[int]
    selected_count: int
    total_articles: int


@dataclass(slots=True)
class KeywordPromptResult:
    """Lightweight result for keyword extraction prompt."""

    prompt: str
    prompt_length: int
    event_id: int


class PromptBuilderError(RuntimeError):
    """Raised when building a prompt is not possible."""


@dataclass(slots=True)
class ArticleCapsule:
    """Normalized article slice used inside the LLM prompt."""

    article_id: int
    title: str
    url: str
    spectrum: str
    source_name: str
    source_type: str
    published_at: datetime | None
    fetched_at: datetime
    summary: str
    key_points: List[str]
    entities: List[str]
    # International perspectives (Epic 9)
    is_international: bool = False
    source_country: str | None = None

    @property
    def reference_time(self) -> datetime:
        return self.published_at or self.fetched_at


class PromptBuilder:
    """Construct LLM prompts that expose pluriform viewpoints for an event."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        settings: Settings | None = None,
    ) -> None:
        # session_factory is kept for backwards compatibility / testing
        # but read operations now use get_read_session() for SQLite cache support
        self._legacy_session_factory = session_factory
        self.settings = settings or get_settings()
        self.template = PROMPT_TEMPLATE

    async def build_prompt(self, event_id: int, *, max_articles: int | None = None) -> str:
        """Compose a deterministic prompt string for the provided event identifier."""

        package = await self.build_prompt_package(event_id, max_articles=max_articles)
        return package.prompt

    async def build_prompt_package(
        self,
        event_id: int,
        *,
        max_articles: int | None = None,
    ) -> PromptGenerationResult:
        """Compose a prompt plus metadata for the provided event identifier."""

        limit = max_articles or self.settings.llm_prompt_article_cap
        if limit <= 0:
            raise PromptBuilderError("Article cap must be positive")

        async with get_read_session() as session:
            event = await self._fetch_event(session, event_id)
            articles = await self._fetch_articles(session, event_id)

        if not articles:
            raise PromptBuilderError(
                f"Event {event_id} has no linked articles; rerun enrichment pipeline first"
            )

        capsules = self._build_capsules(articles)
        selected = self._select_balanced_subset(capsules, limit=limit)
        if not selected:
            raise PromptBuilderError(
                f"Unable to build prompt for event {event_id}: selection yielded no articles"
            )

        context_block = self._format_event_context(event, selected, total=len(capsules))
        capsule_block = self._format_article_capsules(selected)

        # Load template from database, fallback to file-based
        template = await _get_prompt_from_db("pluriform", self.template)
        prompt = template
        prompt = prompt.replace("{event_context}", context_block)
        prompt = prompt.replace("{article_capsules}", capsule_block)

        prompt_length = len(prompt)
        max_chars = self.settings.llm_prompt_max_characters

        # Iteratively reduce article count if prompt is still too long after trimming
        while prompt_length > max_chars and len(selected) > 1:
            if prompt_length > max_chars:
                trimmed_block, trimmed_capsules = self._trim_prompt(selected, context_block)
                prompt = self.template
                prompt = prompt.replace("{event_context}", context_block)
                prompt = prompt.replace("{article_capsules}", trimmed_block)
                selected = trimmed_capsules
                prompt_length = len(prompt)

            # If still too long, reduce article count and rebuild
            if prompt_length > max_chars and len(selected) > 1:
                # Reduce by one article and try again
                selected = selected[:-1]
                capsule_block = self._format_article_capsules(selected)
                prompt = self.template
                prompt = prompt.replace("{event_context}", context_block)
                prompt = prompt.replace("{article_capsules}", capsule_block)
                prompt_length = len(prompt)
                LOG.debug(
                    "prompt_too_long_reducing",
                    event_id=event_id,
                    reduced_to=len(selected),
                    prompt_length=prompt_length,
                    max_chars=max_chars,
                )

        # Final check - if still too long with just 1 article, we have a problem
        if prompt_length > max_chars:
            raise PromptBuilderError(
                f"Prompt length ({prompt_length}) exceeds maximum ({max_chars}) even with minimum articles; "
                "check template size or increase llm_prompt_max_characters"
            )

        LOG.info(
            "prompt_built",
            event_id=event_id,
            article_count=len(capsules),
            selected_count=len(selected),
            prompt_length=prompt_length,
            limit=max_chars,
        )
        return PromptGenerationResult(
            prompt=prompt,
            prompt_length=prompt_length,
            selected_article_ids=[capsule.article_id for capsule in selected],
            selected_count=len(selected),
            total_articles=len(capsules),
        )

    async def _fetch_event(self, session: AsyncSession, event_id: int) -> Event:
        event = await session.get(Event, event_id)
        if event is None or event.archived_at is not None:
            raise PromptBuilderError(f"Event {event_id} bestaat niet of is gearchiveerd")
        return event

    async def _fetch_articles(self, session: AsyncSession, event_id: int) -> List[Article]:
        stmt = (
            select(Article)
            .join(EventArticle, EventArticle.article_id == Article.id)
            .where(EventArticle.event_id == event_id)
            .order_by(Article.published_at.desc(), Article.fetched_at.desc())
        )
        result = await session.execute(stmt)
        articles = list(result.scalars().all())
        return articles

    def _build_capsules(self, articles: Sequence[Article]) -> List[ArticleCapsule]:
        capsules: List[ArticleCapsule] = []
        for article in articles:
            if not article.content or not article.content.strip():
                raise PromptBuilderError(
                    "Artikel mist volledige content; voer de verrijkingsstap opnieuw uit voordat je een prompt bouwt"
                )

            spectrum = _coerce_spectrum(article.source_metadata)
            source_type = _coerce_source_type(article.source_metadata)
            summary = _derive_summary(article)
            key_points = _extract_key_points(article)
            entities = _extract_entities(article)

            capsules.append(
                ArticleCapsule(
                    article_id=article.id,
                    title=article.title,
                    url=article.url,
                    spectrum=spectrum,
                    source_name=article.source_name or "onbekend",
                    source_type=source_type,
                    published_at=article.published_at,
                    fetched_at=article.fetched_at,
                    summary=summary,
                    key_points=key_points,
                    entities=entities,
                    is_international=article.is_international,
                    source_country=article.source_country,
                )
            )
        return capsules

    def _select_balanced_subset(
        self,
        capsules: Sequence[ArticleCapsule],
        *,
        limit: int,
    ) -> List[ArticleCapsule]:
        # Step 1: Separate international and Dutch articles
        international = [c for c in capsules if c.is_international]
        dutch = [c for c in capsules if not c.is_international]

        selection: List[ArticleCapsule] = []

        # Step 2: Include ALL international articles first (they provide unique perspectives)
        # Sort by recency and add to selection
        international_sorted = sorted(
            international, key=lambda c: c.reference_time, reverse=True
        )
        for capsule in international_sorted:
            if len(selection) >= limit:
                break
            selection.append(capsule)

        remaining_slots = limit - len(selection)

        # Step 3: Fill remaining slots with Dutch articles using balanced spectrum selection
        if remaining_slots > 0 and dutch:
            grouped: Mapping[str, deque[ArticleCapsule]] = _group_by_spectrum(dutch)
            ordered_spectra = _order_spectra(grouped)

            iteration = 0
            while len(selection) < limit and ordered_spectra:
                iteration += 1
                for spectrum in list(ordered_spectra):
                    queue = grouped.get(spectrum)
                    if not queue:
                        continue
                    if len(selection) >= limit:
                        break
                    capsule = queue.popleft()
                    selection.append(capsule)
                    if not queue:
                        grouped.pop(spectrum, None)
                ordered_spectra = _order_spectra(grouped)
                if iteration > limit * 2:
                    break

        if len(selection) > limit:
            selection = selection[:limit]

        selection.sort(key=lambda item: item.reference_time, reverse=True)
        LOG.info(
            "article_selection",
            selected=[
                {
                    "article_id": item.article_id,
                    "spectrum": item.spectrum,
                    "is_international": item.is_international,
                    "source_country": item.source_country,
                    "published_at": item.reference_time.isoformat(),
                }
                for item in selection
            ],
            international_count=len([s for s in selection if s.is_international]),
            dutch_count=len([s for s in selection if not s.is_international]),
        )
        return selection

    def _format_event_context(
        self,
        event: Event,
        capsules: Sequence[ArticleCapsule],
        *,
        total: int,
    ) -> str:
        times = [capsule.reference_time for capsule in capsules]
        earliest = min(times).isoformat() if times else "onbekend"
        latest = max(times).isoformat() if times else "onbekend"
        distribution = _assemble_distribution(event, capsules)

        # Count international sources
        international_capsules = [c for c in capsules if c.is_international]
        dutch_count = len(capsules) - len(international_capsules)
        international_count = len(international_capsules)
        international_countries = sorted(set(
            c.source_country for c in international_capsules if c.source_country
        ))

        lines = [
            f"- Event ID: {event.id}",
            f"- Titel: {event.title or 'onbekend'}",
            f"- Omschrijving: {event.description or 'n.v.t.'}",
            f"- Periode: {earliest} t/m {latest}",
            f"- Totaal aantal gekoppelde artikelen: {total}",
            f"- Nederlandse bronnen: {dutch_count}",
            f"- Internationale bronnen: {international_count}",
        ]
        if international_countries:
            lines.append(f"- Landen internationale bronnen: {', '.join(international_countries)}")
        lines.append("- Spectrumverdeling (geselecteerde subset):")
        for spectrum, count in distribution.items():
            lines.append(f"  * {spectrum}: {count}")
        if event.tags:
            tags = ", ".join(event.tags)
            lines.append(f"- Labels: {tags}")
        return "\n".join(lines)

    def _format_article_capsules(self, capsules: Sequence[ArticleCapsule]) -> str:
        blocks: List[str] = []
        for idx, capsule in enumerate(capsules, start=1):
            timeframe = capsule.reference_time.isoformat()
            key_points = capsule.key_points or [capsule.summary]
            key_block = "\n".join(f"    - {point}" for point in key_points)
            entity_block = ", ".join(capsule.entities[:5]) or "geen expliciete entiteiten"
            # Build source line with optional country for international sources
            source_line = f"   Bron: {capsule.source_name} | Spectrum: {capsule.spectrum} | Type: {capsule.source_type}"
            if capsule.is_international and capsule.source_country:
                source_line += f" | Land: {capsule.source_country} (INTERNATIONAAL)"
            block = (
                f"{idx}. {capsule.title}\n"
                f"{source_line}\n"
                f"   Gepubliceerd: {timeframe}\n"
                f"   Samenvatting: {capsule.summary}\n"
                f"   Kernpunten:\n{key_block}\n"
                f"   Entiteiten: {entity_block}\n"
                f"   URL: {capsule.url}"
            )
            blocks.append(block)
        return "\n\n".join(blocks)

    def _trim_prompt(
        self,
        capsules: Sequence[ArticleCapsule],
        context: str,
    ) -> tuple[str, List[ArticleCapsule]]:
        """Trim article capsules until prompt roughly fits the character budget."""

        max_chars = self.settings.llm_prompt_max_characters
        trimmed_capsules = list(capsules)
        blocks = self._format_article_capsules(trimmed_capsules)
        prompt = self.template.replace("{event_context}", context).replace("{article_capsules}", blocks)
        if len(prompt) <= max_chars:
            return blocks, trimmed_capsules

        while len(trimmed_capsules) > 1:
            trimmed_capsules.pop()
            blocks = self._format_article_capsules(trimmed_capsules)
            prompt = self.template.replace("{event_context}", context).replace("{article_capsules}", blocks)
            if len(prompt) <= max_chars:
                return blocks, trimmed_capsules

        return blocks, trimmed_capsules

    async def build_factual_prompt_package(
        self,
        event_id: int,
        *,
        max_articles: int | None = None,
    ) -> PromptGenerationResult:
        """Build prompt for phase 1: factual analysis (summary, timeline, clusters, contradictions)."""
        limit = max_articles or self.settings.llm_prompt_article_cap
        if limit <= 0:
            raise PromptBuilderError("Article cap must be positive")

        async with get_read_session() as session:
            event = await self._fetch_event(session, event_id)
            articles = await self._fetch_articles(session, event_id)

        if not articles:
            raise PromptBuilderError(
                f"Event {event_id} has no linked articles; rerun enrichment pipeline first"
            )

        capsules = self._build_capsules(articles)
        selected = self._select_balanced_subset(capsules, limit=limit)
        if not selected:
            raise PromptBuilderError(
                f"Unable to build prompt for event {event_id}: selection yielded no articles"
            )

        context_block = self._format_event_context(event, selected, total=len(capsules))
        capsule_block = self._format_article_capsules(selected)

        # Load template from database, fallback to file-based
        template = await _get_prompt_from_db("factual", _FILE_FACTUAL_TEMPLATE)
        prompt = template
        prompt = prompt.replace("{event_context}", context_block)
        prompt = prompt.replace("{article_capsules}", capsule_block)

        LOG.info(
            "factual_prompt_built",
            event_id=event_id,
            selected_count=len(selected),
            prompt_length=len(prompt),
        )
        return PromptGenerationResult(
            prompt=prompt,
            prompt_length=len(prompt),
            selected_article_ids=[c.article_id for c in selected],
            selected_count=len(selected),
            total_articles=len(capsules),
        )

    async def build_critical_prompt_package(
        self,
        event_id: int,
        factual_summary: str,
        *,
        max_articles: int | None = None,
    ) -> PromptGenerationResult:
        """Build prompt for phase 2: critical analysis (frames, fallacies, authority, media)."""
        limit = max_articles or self.settings.llm_prompt_article_cap
        if limit <= 0:
            raise PromptBuilderError("Article cap must be positive")

        async with get_read_session() as session:
            event = await self._fetch_event(session, event_id)
            articles = await self._fetch_articles(session, event_id)

        if not articles:
            raise PromptBuilderError(
                f"Event {event_id} has no linked articles; rerun enrichment pipeline first"
            )

        capsules = self._build_capsules(articles)
        selected = self._select_balanced_subset(capsules, limit=limit)
        if not selected:
            raise PromptBuilderError(
                f"Unable to build prompt for event {event_id}: selection yielded no articles"
            )

        context_block = self._format_event_context(event, selected, total=len(capsules))
        capsule_block = self._format_article_capsules(selected)

        # Load template from database, fallback to file-based
        template = await _get_prompt_from_db("critical", _FILE_CRITICAL_TEMPLATE)
        prompt = template
        prompt = prompt.replace("{event_context}", context_block)
        prompt = prompt.replace("{factual_summary}", factual_summary)
        prompt = prompt.replace("{article_capsules}", capsule_block)

        LOG.info(
            "critical_prompt_built",
            event_id=event_id,
            selected_count=len(selected),
            prompt_length=len(prompt),
        )
        return PromptGenerationResult(
            prompt=prompt,
            prompt_length=len(prompt),
            selected_article_ids=[c.article_id for c in selected],
            selected_count=len(selected),
            total_articles=len(capsules),
        )

    async def build_keyword_extraction_prompt(
        self,
        event_id: int,
    ) -> KeywordPromptResult:
        """Build a lightweight prompt for keyword extraction (pre-international enrichment).

        This prompt only includes event context (title, entities, description) without
        full article content, making it much cheaper to run. Used to extract search
        keywords before fetching international articles.
        """
        async with get_read_session() as session:
            event = await self._fetch_event(session, event_id)

        # Build minimal context for keyword extraction
        context_lines = [
            f"- Event ID: {event.id}",
            f"- Title: {event.title or 'unknown'}",
        ]

        if event.description:
            context_lines.append(f"- Description: {event.description}")

        # Add key entities if available
        if event.centroid_entities:
            entity_strings = []
            for entity in event.centroid_entities[:10]:
                text = entity.get("text", "")
                label = entity.get("label", "")
                if text:
                    entity_strings.append(f"{text} ({label})" if label else text)
            if entity_strings:
                context_lines.append(f"- Key entities: {', '.join(entity_strings)}")

        # Add tags if available
        if event.tags:
            context_lines.append(f"- Tags: {', '.join(event.tags)}")

        context_block = "\n".join(context_lines)

        # Load template from database, fallback to file-based
        template = await _get_prompt_from_db("keyword_extraction", _FILE_KEYWORD_TEMPLATE)
        prompt = template.replace("{event_context}", context_block)

        LOG.info(
            "keyword_extraction_prompt_built",
            event_id=event_id,
            prompt_length=len(prompt),
        )
        return KeywordPromptResult(
            prompt=prompt,
            prompt_length=len(prompt),
            event_id=event_id,
        )


def _coerce_spectrum(metadata: Mapping[str, object] | None) -> str:
    spectrum = None
    if metadata and isinstance(metadata, Mapping):
        spectrum = metadata.get("spectrum") or metadata.get("political_spectrum")
    if not spectrum:
        return SPECTRUM_FALLBACK
    return str(spectrum).lower()


def _coerce_source_type(metadata: Mapping[str, object] | None) -> str:
    if metadata and isinstance(metadata, Mapping):
        source_type = metadata.get("media_type") or metadata.get("type")
        if source_type:
            return str(source_type)
    return "onbekend"


def _derive_summary(article: Article) -> str:
    summary = article.summary or ""
    if summary:
        return shorten(summary.strip(), width=DEFAULT_SUMMARY_CHAR_LIMIT, placeholder="...")
    sentences = _split_sentences(article.content)
    if not sentences:
        return shorten(article.content.strip(), width=DEFAULT_SUMMARY_CHAR_LIMIT, placeholder="...")
    return shorten(sentences[0], width=DEFAULT_SUMMARY_CHAR_LIMIT, placeholder="...")


def _extract_key_points(article: Article) -> List[str]:
    sentences = _split_sentences(article.content)
    if not sentences:
        return []
    primary = sentences[:ARTICLE_CAPSULE_SENTENCE_LIMIT]
    # Remove potential duplicates with summary
    unique: List[str] = []
    seen = set()
    for sentence in primary:
        normalized = sentence.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(shorten(normalized, width=DEFAULT_SUMMARY_CHAR_LIMIT, placeholder="..."))
    return unique


def _extract_entities(article: Article) -> List[str]:
    raw = article.entities or []
    entities: List[str] = []
    for entity in raw:
        if not isinstance(entity, Mapping):
            continue
        text = str(entity.get("text") or entity.get("name") or "").strip()
        label = str(entity.get("label") or entity.get("type") or "").strip()
        if not text:
            continue
        descriptor = text if not label else f"{text} ({label})"
        if descriptor not in entities:
            entities.append(descriptor)
    return entities


def _split_sentences(text: str) -> List[str]:
    clean = text.strip()
    if not clean:
        return []
    parts = SENTENCE_PATTERN.split(clean)
    sentences = [part.strip() for part in parts if part.strip()]
    if not sentences:
        sentences = [clean]
    return sentences


def _group_by_spectrum(capsules: Sequence[ArticleCapsule]) -> Mapping[str, deque[ArticleCapsule]]:
    grouped: dict[str, deque[ArticleCapsule]] = defaultdict(deque)
    for capsule in capsules:
        grouped[capsule.spectrum].append(capsule)
    for queue in grouped.values():
        ordered = sorted(queue, key=lambda item: item.reference_time, reverse=True)
        queue.clear()
        queue.extend(ordered)
    return grouped


def _order_spectra(grouped: Mapping[str, deque[ArticleCapsule]]) -> List[str]:
    if not grouped:
        return []
    ordering = sorted(
        grouped.keys(),
        key=lambda spectrum: grouped[spectrum][0].reference_time if grouped[spectrum] else datetime.min,
        reverse=True,
    )
    return ordering


def _assemble_distribution(event: Event, capsules: Sequence[ArticleCapsule]) -> Mapping[str, int]:
    distribution: dict[str, int] = {}
    if event.spectrum_distribution and isinstance(event.spectrum_distribution, Mapping):
        distribution.update({str(k): int(v) for k, v in event.spectrum_distribution.items()})
    for capsule in capsules:
        distribution[capsule.spectrum] = distribution.get(capsule.spectrum, 0) + 1
    return distribution


__all__ = ["KeywordPromptResult", "PromptBuilder", "PromptBuilderError", "PromptGenerationResult"]
