"""Prompt builder for pluriform LLM insights (Story 3.1)."""

from __future__ import annotations

import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
from importlib import resources
from textwrap import indent, shorten
from typing import Any, Iterable, List, Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger
from backend.app.db.models import Article, Event, EventArticle, EventDocument, PressRelease
from backend.app.db.session import get_sessionmaker
from backend.app.services.background_sources import public_body
from backend.app.services.copy_detection import NGRAM, TOKEN
from backend.app.services.llm_config_service import get_llm_config_service

LOG = get_logger(__name__).bind(component="PromptBuilder")

# Places kept for foreign outlets next to the Dutch ones. The prompt gets only their headline
# (Google News); their balloon on the event page shows the article digest, not the analysis.
FOREIGN_RESERVE = 2
SENTENCE_PATTERN = re.compile(r"(?<=[.!?])\s+")
SPECTRUM_FALLBACK = "onbekend"
DEFAULT_SUMMARY_CHAR_LIMIT = 320
# The analysis reads the article text up to this length (at a sentence end). Until 2026-10-13 it
# read only the first three sentences, so whatever came later (a quote, the precedent) was
# "missing" and Zoek met AI looked for what was already in the news (event 8786).
ARTICLE_TEXT_CHAR_LIMIT = 4000
# The texts of one prompt share the room of the article cap (16 x 4,000 characters). A news item
# with few or short articles gives what it leaves to its long ones, up to this length: one in four
# Dutch articles is longer than 4,000 characters (2.9 % longer than 8,000, 1.1 % than 12,000;
# 3,052 articles, 2026-11-17). Event 11671: of NieuwRechts' 5,366 characters the analysis read
# 4,000, so the chairman of the mosque board (quoted after that) was "niet aan het woord" and the
# 1.6 million the community raised was "missing".
ARTICLE_TEXT_MAX_CHARS = 12000
CLIP_NOTE = (
    'Ingekort: bij "Tekst (ingekort)" staat alleen het begin van een lang artikel, tot […]. Wat '
    "daarna komt, is niet gelezen. Reken wat in dat deel kan staan (een stem die later aan het "
    "woord komt, een cijfer, een bron, achtergrond) bij dat medium niet als ontbrekend."
)
# Zelfde tekst (Story 14.27): an article with the same text as one the analysis reads already brings
# only the sentences that are not in the prompt yet, and takes a place of the cap only with this
# many words of its own. Until 2026-10-19 three ANP copies took three places, and the analysis wrote
# "volgens De Telegraaf" about what all three brought.
OWN_TEXT_MIN_WORDS = 40
# A sentence is in the prompt already when this share of its runs of NGRAM words is there
SEEN_SENTENCE_SHARE = 0.5
COPY_NOTE = (
    'Zelfde tekst: bij "Zelfde tekst als …" brengen meer media één tekst, een persbureaubericht '
    "of één artikel van een uitgever in meer titels. Die tekst staat hieronder één keer, bij het "
    "eerste artikel; bij de andere staat alleen wat dat medium er zelf aan toevoegt. Zo'n tekst "
    "is één bron, geen bevestiging door meer media: schrijf wat erin staat niet toe aan één van "
    'die media, maar aan de tekst die ze samen brengen ("meldt het ANP-bericht dat [media] '
    'brachten"). Wat een medium zelf toevoegt, is van dat medium.'
)
# Story 14.30: the pages an article links to in its text (source_metadata.links), at most this many
# per article, those of public bodies first. Until 2026-11-15 the analysis read the text without
# them and could call a claim unsourced while the article linked the Kamerbrief it came from.
PROMPT_LINKS_PER_ARTICLE = 5
LINK_NOTE = (
    "Links in de tekst: de pagina's waar een artikel in zijn tekst naar linkt. Zo noemt het een "
    "bron: een Kamerstuk of rapport waar een bewering vandaan komt, of het bericht (op X) waarin "
    "iemand iets zegt. Rust een bewering op zo'n stuk, dan is ze niet 'zonder bron': noem het stuk "
    "waar het artikel naar linkt. Of het stuk de bewering draagt, is niet gelezen."
)

# Stories 14.34/14.39: quotes (and text) of an article that stand word for word in a news release
# of the Rijksoverheid, the OM, the Politie, … (job "Official Sources", event_documents source
# "persbericht")
PRESS_NOTE = (
    "Uit het persbericht: bij een artikel staan de citaten die letterlijk in een persbericht staan "
    "(van een ministerie, het OM, de politie of een andere afzender). Zo'n citaat komt uit het "
    "persbericht; of de journalist de spreker zelf sprak, staat er niet. Tel het niet als een "
    "gesprek van dat medium, en schrijf wat er staat toe aan het persbericht van die afzender."
)
PRESS_QUOTE_CHARS = 160
# Story 14.40: the analysis reads the text of the press releases about the news (event_documents
# source "persbericht", text in the local press_releases): the quoted ones first, then the best
# topic score; at most this many, each up to this length (at a sentence end)
RELEASES_IN_PROMPT = 2
RELEASE_TEXT_CHARS = 3000
RELEASE_NOTE = (
    "Persberichten: onder de artikelen staat de eigen tekst van een afzender over dit nieuws (een "
    "ministerie, het OM, de politie, een rechtbank, het CBS of een andere). Een persbericht is "
    "geen artikel en geen medium: tel het niet mee bij de bronnen of de media, en een afzender "
    "die alleen in zijn persbericht spreekt, komt in de artikelen niet aan het woord. Het is de "
    'versie van de afzender: schrijf wat erin staat toe aan die afzender ("volgens het '
    'persbericht van het OM"), niet als vaststaand feit. Leg het naast de artikelen: wat nemen ze '
    "over, wat laten ze weg, waar wijken ze af. Wat in een persbericht staat dat later verscheen "
    "dan een artikel, ontbreekt niet in dat artikel."
)


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
class CopyInfo:
    """The text an article shares with articles of other outlets, as copy detection stored it in
    ``event_articles.scoring_breakdown.copy`` (Story 14.27)."""

    group: str
    source: str | None = None
    agency: str | None = None
    likely_agency: str | None = None
    publisher: str | None = None
    # How much of this article's text the others have; little for a liveblog that contains it
    share: float | None = None

    @property
    def kind(self) -> str:
        """What the one text is, like the event page names it."""
        if self.source == "persbureau":
            if self.agency:
                return f"{self.agency}-tekst"
            if self.likely_agency:
                return f"persbureautekst (vermoedelijk {self.likely_agency})"
            return "persbureautekst"
        if self.source == "uitgever":
            if self.publisher:
                return f"één artikel van {self.publisher} in meer titels"
            return "één artikel in meer titels"
        # Titles of one owner: they take agency copy too
        if self.publisher:
            return f"persbureautekst of een artikel van {self.publisher}"
        return "herkomst onbekend"


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
    text: str
    entities: List[str]
    # International perspectives (Epic 9)
    is_international: bool = False
    source_country: str | None = None
    # Zelfde tekst (Story 14.27): the group, and what the selection made of it. The first article
    # of a group in the prompt shows the shared text once, the others only their own sentences
    copy: CopyInfo | None = None
    copy_lead: ArticleCapsule | None = None
    copy_members: list[ArticleCapsule] = field(default_factory=list)
    shared_text: str = ""
    own_text: str = ""
    # Its sentences in the prompt already are left out (the rest is own_text)
    reduced: bool = False
    # The whole text: what the prompt reads of it is clipped, a shared passage may come later
    body: str = ""
    # Pages the text links to (Story 14.30), those of public bodies first
    links: list[str] = field(default_factory=list)
    # What of the text stands word for word in a press release (Stories 14.34/14.39)
    press: list[str] = field(default_factory=list)
    # The prompt has only the start of the text (see CLIP_NOTE)
    clipped: bool = False

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
        self._session_factory = session_factory
        self.settings = settings or get_settings()
        self.template = PROMPT_TEMPLATE

    def _sessions(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory or get_sessionmaker()

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

        async with self._sessions()() as session:
            event = await self._fetch_event(session, event_id)
            articles = await self._fetch_articles(session, event_id)
            copies = await self._fetch_copies(session, event_id)
            press = await self._fetch_press(session, event_id)

        if not articles:
            raise PromptBuilderError(
                f"Event {event_id} has no linked articles; rerun enrichment pipeline first"
            )

        capsules = self._build_capsules(articles, copies)
        _attach_press(capsules, press)
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

    async def _fetch_copies(self, session: AsyncSession, event_id: int) -> dict[int, CopyInfo]:
        """Zelfde tekst (Story 14.27): per article the text it shares with articles of other
        outlets, as copy detection stored it on the link."""
        stmt = select(EventArticle.article_id, EventArticle.scoring_breakdown).where(
            EventArticle.event_id == event_id
        )
        copies: dict[int, CopyInfo] = {}
        for article_id, breakdown in await session.execute(stmt):
            copy = breakdown.get("copy") if isinstance(breakdown, Mapping) else None
            if not isinstance(copy, Mapping) or copy.get("group") is None:
                continue
            copies[article_id] = CopyInfo(
                group=str(copy["group"]),
                source=copy.get("source"),
                agency=copy.get("agency"),
                likely_agency=copy.get("likely_agency"),
                publisher=copy.get("publisher"),
                share=copy.get("share"),
            )
        return copies

    async def _fetch_press(self, session: AsyncSession, event_id: int) -> dict[int, list[str]]:
        """Citaat uit het persbericht (Story 14.34): per article what stands in a release."""
        stmt = select(EventDocument.title, EventDocument.location, EventDocument.details).where(
            EventDocument.event_id == event_id, EventDocument.source == "persbericht"
        )
        press: dict[int, list[str]] = defaultdict(list)
        for title, location, details in await session.execute(stmt):
            entries = details.get("quoted_by") if isinstance(details, Mapping) else None
            for entry in entries or []:
                if not isinstance(entry, Mapping) or not isinstance(entry.get("article_id"), int):
                    continue
                press[entry["article_id"]].append(_press_line(title, location, entry))
        return dict(press)

    async def _fetch_releases(self, session: AsyncSession, event_id: int) -> list[ReleaseCapsule]:
        """Persberichten over dit nieuws (Story 14.40): the texts of the releases of the news."""
        stmt = (
            select(
                EventDocument.title,
                EventDocument.location,
                EventDocument.url,
                EventDocument.published_at,
                EventDocument.details,
                PressRelease.text,
            )
            .join(PressRelease, PressRelease.url == EventDocument.url)
            .where(EventDocument.event_id == event_id, EventDocument.source == "persbericht")
        )
        return _pick_releases(
            ReleaseCapsule(
                title=title,
                sender=location,
                url=url,
                published_at=published_at,
                text=body,
                quoted=bool(details.get("quoted_by")) if isinstance(details, Mapping) else False,
                topic=_float(details.get("topic")) if isinstance(details, Mapping) else 0.0,
            )
            for title, location, url, published_at, details, body in await session.execute(stmt)
        )

    def _build_capsules(
        self, articles: Sequence[Article], copies: Mapping[int, CopyInfo] | None = None
    ) -> List[ArticleCapsule]:
        """One capsule per article with text. A find of Zoek met AI has no text, only its digest;
        an article without either is left out instead of stopping the analysis of the whole news
        (event 8786 stayed at 5 of 17 articles from 2026-10-08)."""

        capsules: List[ArticleCapsule] = []
        for article in articles:
            body = _article_text(article)
            if not body:
                LOG.warning("prompt_article_without_text", article_id=article.id)
                continue

            spectrum = _coerce_spectrum(article.source_metadata)
            source_type = _coerce_source_type(article.source_metadata)
            summary = _derive_summary(article, body)
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
                    text=_clip_text(body),
                    body=body,
                    entities=entities,
                    is_international=article.is_international,
                    source_country=article.source_country,
                    copy=(copies or {}).get(article.id),
                    links=_article_links(article),
                )
            )
        if articles and not capsules:
            raise PromptBuilderError(
                "Geen artikel met tekst; voer de verrijkingsstap opnieuw uit voordat je een prompt bouwt"
            )
        return capsules

    def _select_balanced_subset(
        self,
        capsules: Sequence[ArticleCapsule],
        *,
        limit: int,
    ) -> List[ArticleCapsule]:
        """The articles the LLM reads, at most `limit`, in this order:

        1. the newest article of every Dutch outlet, spread over the spectrum, keeping a few places
           for foreign outlets: an outlet outside the analysis gets no stance, sentence or speakers
           on the event page;
        2. the newest article of every foreign outlet (the prompt gets only its headline);
        3. the other Dutch articles, spread over the spectrum;
        4. the other foreign articles.

        Until 2026-10-06 all foreign articles came first, so eight Google News headlines could push
        every Dutch article out of the prompt. Of one text at more outlets the first is read whole
        and the others bring only their own sentences (``_read_copies_once``).
        """
        newest_first = sorted(capsules, key=lambda c: c.reference_time, reverse=True)
        dutch_firsts, dutch_rest = _split_first_per_source(
            [c for c in newest_first if not c.is_international]
        )
        foreign_firsts, foreign_rest = _split_first_per_source(
            [c for c in newest_first if c.is_international]
        )
        dutch_firsts = _spread_over_spectrum(dutch_firsts)
        dutch_rest = _spread_over_spectrum(dutch_rest)

        room = max(limit - min(FOREIGN_RESERVE, len(foreign_firsts)), 1)
        ordered = (
            dutch_firsts[:room] + foreign_firsts + dutch_firsts[room:] + dutch_rest + foreign_rest
        )
        # The longest texts that can take the places: whichever articles do, they fit the room
        longest = sorted((len(c.body) for c in ordered), reverse=True)[:limit]
        level = _text_level(longest, budget=limit * ARTICLE_TEXT_CHAR_LIMIT)
        for capsule in ordered:
            if capsule.body:
                capsule.text = _clip_text(capsule.body, level)
                capsule.clipped = len(capsule.body) > level
        selection = _read_copies_once(ordered, limit)

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
            same_text=[s.article_id for s in selection if s.copy_lead is not None],
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
        for kind, outlets in _copy_groups(capsules):
            lines.append(f"- Zelfde tekst bij {_join_names(outlets)}: {kind}")
        lines.append("- Spectrumverdeling (geselecteerde subset):")
        for spectrum, count in distribution.items():
            lines.append(f"  * {spectrum}: {count}")
        if event.tags:
            tags = ", ".join(event.tags)
            lines.append(f"- Labels: {tags}")
        return "\n".join(lines)

    def _format_article_capsules(self, capsules: Sequence[ArticleCapsule]) -> str:
        numbers = {capsule.article_id: idx for idx, capsule in enumerate(capsules, start=1)}
        blocks: List[str] = []
        for idx, capsule in enumerate(capsules, start=1):
            timeframe = capsule.reference_time.isoformat()
            entity_block = ", ".join(capsule.entities[:5]) or "geen expliciete entiteiten"
            # Build source line with optional country for international sources
            source_line = f"   Bron: {capsule.source_name} | Spectrum: {capsule.spectrum} | Type: {capsule.source_type}"
            if capsule.is_international and capsule.source_country:
                source_line += f" | Land: {capsule.source_country} (INTERNATIONAAL)"
            copy_line, text_block = _text_lines(capsule, numbers)
            links = "; ".join(capsule.links)
            links_line = f"   Links in de tekst: {links}\n" if links else ""
            press_line = "".join(f"   Uit het persbericht: {line}\n" for line in capsule.press)
            block = (
                f"{idx}. {capsule.title}\n"
                f"{source_line}\n"
                f"   Gepubliceerd: {timeframe}\n"
                f"{copy_line}"
                f"   Samenvatting: {capsule.summary}\n"
                f"{text_block}"
                f"{links_line}"
                f"{press_line}"
                f"   Entiteiten: {entity_block}\n"
                f"   URL: {capsule.url}"
            )
            blocks.append(block)
        notes = [
            note
            for note, present in (
                (COPY_NOTE, any(_copy_others(capsule, numbers) for capsule in capsules)),
                (CLIP_NOTE, any(capsule.clipped for capsule in capsules)),
                (LINK_NOTE, any(capsule.links for capsule in capsules)),
                (PRESS_NOTE, any(capsule.press for capsule in capsules)),
            )
            if present
        ]
        return "\n\n".join([*notes, *blocks])

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

        async with self._sessions()() as session:
            event = await self._fetch_event(session, event_id)
            articles = await self._fetch_articles(session, event_id)
            copies = await self._fetch_copies(session, event_id)
            press = await self._fetch_press(session, event_id)
            releases = await self._fetch_releases(session, event_id)

        if not articles:
            raise PromptBuilderError(
                f"Event {event_id} has no linked articles; rerun enrichment pipeline first"
            )

        capsules = self._build_capsules(articles, copies)
        _attach_press(capsules, press)
        selected = self._select_balanced_subset(capsules, limit=limit)
        if not selected:
            raise PromptBuilderError(
                f"Unable to build prompt for event {event_id}: selection yielded no articles"
            )

        context_block = self._format_event_context(event, selected, total=len(capsules))
        capsule_block = _with_releases(self._format_article_capsules(selected), releases)

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

        async with self._sessions()() as session:
            event = await self._fetch_event(session, event_id)
            articles = await self._fetch_articles(session, event_id)
            copies = await self._fetch_copies(session, event_id)
            press = await self._fetch_press(session, event_id)
            releases = await self._fetch_releases(session, event_id)

        if not articles:
            raise PromptBuilderError(
                f"Event {event_id} has no linked articles; rerun enrichment pipeline first"
            )

        capsules = self._build_capsules(articles, copies)
        _attach_press(capsules, press)
        selected = self._select_balanced_subset(capsules, limit=limit)
        if not selected:
            raise PromptBuilderError(
                f"Unable to build prompt for event {event_id}: selection yielded no articles"
            )

        context_block = self._format_event_context(event, selected, total=len(capsules))
        capsule_block = _with_releases(self._format_article_capsules(selected), releases)

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
        async with self._sessions()() as session:
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


def _article_text(article: Article) -> str:
    """The article text; for a find of Zoek met AI (stored without text) its Dutch digest."""

    content = (article.content or "").strip()
    if content:
        return content
    metadata = article.source_metadata if isinstance(article.source_metadata, Mapping) else {}
    digest = metadata.get("digest")
    if isinstance(digest, Mapping):
        return str(digest.get("nl") or "").strip()
    return ""


def _article_links(article: Article) -> list[str]:
    """The pages the article links to in its text, those of public bodies first."""

    metadata = article.source_metadata if isinstance(article.source_metadata, Mapping) else {}
    links = [link for link in metadata.get("links") or [] if isinstance(link, str)]
    # Stable: within each group the order of the text
    links.sort(key=lambda link: public_body(link) is None)
    return links[:PROMPT_LINKS_PER_ARTICLE]


def _press_line(title: str | None, location: str | None, entry: Mapping[str, Any]) -> str:
    """'persbericht van Ministerie van OCW, "Titel": citaten “…”; 47 % van de eigen tekst'."""

    who = f"persbericht van {location}" if location else "persbericht van de Rijksoverheid"
    head = f'{who}, "{" ".join((title or "").split())[:120]}"'
    parts: list[str] = []
    quotes = [q for q in entry.get("quotes") or [] if isinstance(q, str) and q.strip()]
    if quotes:
        parts.append("citaten " + "; ".join(f"“{q[:PRESS_QUOTE_CHARS]}”" for q in quotes))
    share = entry.get("share")
    if isinstance(share, (int, float)) and share >= 0.05:
        parts.append(f"{round(share * 100)} % van de eigen tekst")
    return f"{head}: {'; '.join(parts)}" if parts else head


@dataclass(slots=True)
class ReleaseCapsule:
    """A press release about the news (Story 14.40)."""

    title: str
    sender: str | None
    url: str
    published_at: datetime | None
    text: str
    # An article of the news quotes it (14.34) / its tf-idf score with the news (14.40)
    quoted: bool = False
    topic: float = 0.0


def _float(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def _pick_releases(releases: Iterable[ReleaseCapsule]) -> list[ReleaseCapsule]:
    """The quoted ones first, then the best topic score, then the earliest; one per text."""
    far = datetime.max.replace(tzinfo=None)
    ordered = sorted(
        (release for release in releases if release.text.strip()),
        key=lambda r: (
            not r.quoted,
            -r.topic,
            r.published_at.replace(tzinfo=None) if r.published_at else far,
        ),
    )
    picked: list[ReleaseCapsule] = []
    for release in ordered:
        # The same release on rijksoverheid.nl and on the site of the body (NVWA, Defensie)
        if any(release.text[:300] == other.text[:300] for other in picked):
            continue
        picked.append(release)
        if len(picked) == RELEASES_IN_PROMPT:
            break
    return picked


def _format_releases(releases: Sequence[ReleaseCapsule]) -> str:
    """The note and per release its sender, time, title and text (up to RELEASE_TEXT_CHARS)."""
    if not releases:
        return ""
    blocks = [RELEASE_NOTE]
    for release in releases:
        sender = release.sender or "de afzender"
        title = " ".join(release.title.split())
        when = release.published_at.isoformat() if release.published_at else "onbekend"
        body = _clip_text(" ".join(release.text.split()), RELEASE_TEXT_CHARS)
        blocks.append(
            f'Persbericht van {sender}: "{title}"\n'
            f"   Gepubliceerd: {when}\n"
            f"   Tekst:\n{indent(body, '    ')}\n"
            f"   URL: {release.url}"
        )
    return "\n\n".join(blocks)


def _with_releases(capsule_block: str, releases: Sequence[ReleaseCapsule]) -> str:
    block = _format_releases(releases)
    return f"{capsule_block}\n\n{block}" if block else capsule_block


def _attach_press(capsules: Sequence[ArticleCapsule], press: Mapping[int, list[str]]) -> None:
    for capsule in capsules:
        capsule.press = list(press.get(capsule.article_id, []))


def _text_level(
    lengths: Sequence[int],
    *,
    budget: int,
    floor: int = ARTICLE_TEXT_CHAR_LIMIT,
    ceiling: int = ARTICLE_TEXT_MAX_CHARS,
) -> int:
    """How long a text may be so that texts of these lengths fit ``budget`` together.

    Short texts take what they need, the long ones share the rest equally: three articles of
    1,500, 3,300 and 5,400 characters are read whole, sixteen long ones 4,000 each. Never under
    ``floor`` (what every article gets) or over ``ceiling``.
    """
    remaining = budget
    for position, length in enumerate(sorted(lengths)):
        share = remaining // (len(lengths) - position)
        if length > share:
            return max(floor, min(ceiling, share))
        remaining -= length
    return ceiling


def _clip_text(text: str, limit: int = ARTICLE_TEXT_CHAR_LIMIT) -> str:
    """At most ``limit`` characters, ending at a sentence or paragraph end when one is near."""

    if len(text) <= limit:
        return text
    head = text[:limit]
    end = max(head.rfind(". "), head.rfind("! "), head.rfind("? "), head.rfind("\n"))
    if end >= limit // 2:
        head = head[: end + 1]
    return head.rstrip() + " […]"


def _derive_summary(article: Article, body: str) -> str:
    summary = article.summary or ""
    if summary:
        return shorten(summary.strip(), width=DEFAULT_SUMMARY_CHAR_LIMIT, placeholder="...")
    sentences = _split_sentences(body)
    if not sentences:
        return shorten(body, width=DEFAULT_SUMMARY_CHAR_LIMIT, placeholder="...")
    return shorten(sentences[0], width=DEFAULT_SUMMARY_CHAR_LIMIT, placeholder="...")


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


def _sentences(text: str) -> list[str]:
    """The sentences of a text that have words (not the "[…]" of a clipped text)."""
    return [sentence for sentence in _split_sentences(text) if TOKEN.search(sentence.lower())]


def _words(text: str) -> int:
    return len(TOKEN.findall(text.lower()))


class _Seen:
    """Text in the prompt, to tell whether a sentence of another article is in it already: most of
    its runs of NGRAM words, or the whole of a shorter sentence."""

    __slots__ = ("grams", "words")

    def __init__(self, text: str = "") -> None:
        self.grams: set[str] = set()
        self.words = " "
        self.add(text)

    def add(self, text: str) -> None:
        tokens = TOKEN.findall(text.lower())
        self.grams.update(" ".join(tokens[i : i + NGRAM]) for i in range(len(tokens) - NGRAM + 1))
        self.words += " ".join(tokens) + " "

    def has(self, sentence: str) -> bool:
        tokens = TOKEN.findall(sentence.lower())
        if len(tokens) < NGRAM:
            return f" {' '.join(tokens)} " in self.words
        grams = [" ".join(tokens[i : i + NGRAM]) for i in range(len(tokens) - NGRAM + 1)]
        return sum(gram in self.grams for gram in grams) >= SEEN_SENTENCE_SHARE * len(grams)


def _read_copies_once(ordered: Sequence[ArticleCapsule], limit: int) -> list[ArticleCapsule]:
    """The articles the analysis reads, in the given order, on at most ``limit`` places.

    Zelfde tekst (Story 14.27): of a text that more outlets bring, the first article in the order
    is read whole. One after it brings only its sentences that are not in the prompt yet (from its
    whole text), and takes a place only with ``OWN_TEXT_MIN_WORDS`` of them: an ANP copy without
    anything of its own is one line, and the places go to other voices. The first article then
    shows which of its sentences the others have (the shared text) and which are its own. A copy
    never takes a place that another article had without this: the first is where it was.
    """
    selection: list[ArticleCapsule] = []
    places = 0
    leads: dict[str, ArticleCapsule] = {}
    seen: dict[str, _Seen] = {}
    for capsule in ordered:
        group = capsule.copy.group if capsule.copy else None
        lead = leads.get(group) if group is not None else None
        if lead is None:
            if places < limit:
                selection.append(capsule)
                places += 1
                if group is not None:
                    leads[group] = capsule
                    seen[group] = _Seen(capsule.text)
            continue
        sentences = _sentences(capsule.body or capsule.text)
        own = [s for s in sentences if not seen[group].has(s)]
        # Nothing in the prompt yet (a passage after the clipped text of the first): read it whole
        reduced = len(own) < len(sentences)
        own_text = _clip_text(" ".join(own)) if reduced else capsule.text
        if not reduced or _words(own_text) >= OWN_TEXT_MIN_WORDS:
            if places >= limit:
                continue
            places += 1
        capsule.copy_lead = lead
        capsule.reduced = reduced
        capsule.own_text = own_text if reduced else ""
        seen[group].add(own_text)
        lead.copy_members.append(capsule)
        selection.append(capsule)
    for lead in leads.values():
        if not lead.copy_members:
            continue
        others = _Seen(" ".join(member.body or member.text for member in lead.copy_members))
        sentences = _sentences(lead.text)
        lead.shared_text = " ".join(s for s in sentences if others.has(s))
        lead.own_text = " ".join(s for s in sentences if not others.has(s))
    return selection


def _copy_others(capsule: ArticleCapsule, numbers: Mapping[int, int]) -> list[ArticleCapsule]:
    """The articles in the prompt with the same text as this one (none when it is alone there)."""
    lead = capsule.copy_lead or capsule
    present = [c for c in (lead, *lead.copy_members) if c.article_id in numbers]
    if lead.article_id not in numbers or len(present) < 2:
        return []
    return [c for c in present if c is not capsule]


def _text_lines(capsule: ArticleCapsule, numbers: Mapping[int, int]) -> tuple[str, str]:
    """The "Zelfde tekst als" line and the text of an article: the shared text at the first article
    of a group, else only what the outlet adds; a plain text for one alone in the prompt."""
    head = "Tekst (ingekort)" if capsule.clipped else "Tekst"
    plain = f"   {head}:\n{indent(capsule.text or capsule.summary, '    ')}\n"
    others = _copy_others(capsule, numbers)
    if not others or capsule.copy is None:
        return "", plain
    names = _join_names([f"{c.source_name} (artikel {numbers[c.article_id]})" for c in others])
    # A liveblog has the text among much of its own (the event page: "bevat deze tekst")
    within = capsule.copy.share is not None and capsule.copy.share < 0.25
    line = (
        f"   Zelfde tekst als {names}: {capsule.copy.kind}"
        f"{', die dit artikel naast veel eigen tekst bevat' if within else ''}\n"
    )
    if capsule.copy_lead is None:
        if not capsule.shared_text:
            return line, plain
        outlets = _join_names(_unique(c.source_name for c in others))
        text = f"   Tekst die ook bij {outlets} staat:\n{indent(capsule.shared_text, '    ')}\n"
        if capsule.own_text:
            own = indent(capsule.own_text, "    ")
            text += f"   Eigen tekst van {capsule.source_name}:\n{own}\n"
        return line, text
    lead = numbers[capsule.copy_lead.article_id]
    if not capsule.reduced:
        return line, plain
    if capsule.own_text:
        return line, (
            f"   Eigen tekst van {capsule.source_name} (de rest staat bij artikel {lead}):\n"
            f"{indent(capsule.own_text, '    ')}\n"
        )
    return line, f"   Tekst: dezelfde als bij artikel {lead}, zonder eigen zinnen\n"


def _copy_groups(capsules: Sequence[ArticleCapsule]) -> list[tuple[str, list[str]]]:
    """Per text that more outlets in the selection bring: what it is, and those outlets."""
    numbers = {capsule.article_id: idx for idx, capsule in enumerate(capsules, start=1)}
    groups: list[tuple[str, list[str]]] = []
    for capsule in capsules:
        if capsule.copy is None or capsule.copy_lead is not None or not capsule.copy_members:
            continue
        outlets = _unique(c.source_name for c in (capsule, *_copy_others(capsule, numbers)))
        if len(outlets) >= 2:
            groups.append((capsule.copy.kind, outlets))
    return groups


def _unique(names: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(names))


def _join_names(names: Sequence[str]) -> str:
    """Names in a sentence: A; A en B; A, B en C."""
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} en {names[-1]}"


def _split_first_per_source(
    capsules: Sequence[ArticleCapsule],
) -> tuple[List[ArticleCapsule], List[ArticleCapsule]]:
    """The first article of every source and the others, both in the given order."""
    seen: set[str] = set()
    firsts: List[ArticleCapsule] = []
    rest: List[ArticleCapsule] = []
    for capsule in capsules:
        if capsule.source_name in seen:
            rest.append(capsule)
        else:
            seen.add(capsule.source_name)
            firsts.append(capsule)
    return firsts, rest


def _spread_over_spectrum(capsules: Sequence[ArticleCapsule]) -> List[ArticleCapsule]:
    """Round robin over the spectra, newest first within each: no side fills the prompt alone."""
    grouped = dict(_group_by_spectrum(capsules))
    ordered: List[ArticleCapsule] = []
    while grouped:
        for spectrum in _order_spectra(grouped):
            queue = grouped[spectrum]
            ordered.append(queue.popleft())
            if not queue:
                del grouped[spectrum]
    return ordered


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
