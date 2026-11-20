from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.app.db.models import Article, Base, Event, EventArticle
from backend.app.llm import PromptBuilder, PromptBuilderError
from backend.app.core.config import Settings


@pytest.fixture
def session_factory() -> async_sessionmaker[AsyncSession]:
    """Create an in-memory SQLite session factory for isolated tests."""
    import asyncio

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return async_sessionmaker(engine, expire_on_commit=False)

    loop = asyncio.new_event_loop()
    try:
        factory = loop.run_until_complete(setup())
        yield factory
    finally:
        loop.run_until_complete(engine.dispose())
        loop.close()


async def _seed_event(
    factory: async_sessionmaker[AsyncSession],
    *,
    spectra: Iterable[str],
    content_stub: str | None = "Deterministic inhoud over het event.",
) -> int:
    now = datetime.now(timezone.utc)
    async with factory() as session:
        event = Event(
            slug="test-event",
            title="Test evenement",
            description="Beschrijving van het testevent",
            first_seen_at=now - timedelta(days=1),
            last_updated_at=now,
            article_count=0,
            spectrum_distribution={},
        )
        session.add(event)
        await session.flush()

        for idx, spectrum in enumerate(spectra, start=1):
            published = now - timedelta(hours=idx)
            base_content = content_stub if content_stub is not None else ""
            content = f"{base_content} Spectrum {spectrum}." if base_content else ""
            article = Article(
                guid=f"guid-{idx}",
                url=f"https://example.com/{idx}",
                title=f"Artikel {idx}",
                summary=f"Samenvatting artikel {idx}",
                content=content,
                source_name=f"Bron {idx}",
                source_metadata={
                    "name": f"Bron {idx}",
                    "spectrum": spectrum,
                    "media_type": "public_broadcaster" if spectrum == "center" else "private_media",
                },
                published_at=published,
                fetched_at=published,
            )
            session.add(article)
            await session.flush()

            link = EventArticle(
                event_id=event.id,
                article_id=article.id,
                similarity_score=0.9,
                scoring_breakdown={"hybrid": 0.9},
            )
            session.add(link)
            event.article_count += 1

        await session.commit()
        return event.id


@pytest.mark.asyncio
async def test_build_prompt_contains_required_sections(session_factory: async_sessionmaker[AsyncSession]) -> None:
    event_id = await _seed_event(session_factory, spectra=["center", "rechts", "links"])
    # Use 10000 chars to accommodate expanded template (Epic 9 country detection)
    settings = Settings(llm_prompt_article_cap=3, llm_prompt_max_characters=10000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    prompt = await builder.build_prompt(event_id)

    assert '"timeline": [' in prompt
    assert '"clusters": [' in prompt
    assert '"contradictions": [' in prompt
    assert "Bron: Bron 1" in prompt
    # Verify spectrum labels appear in the prompt (format: "Spectrum: {value}")
    assert "Spectrum:" in prompt


@pytest.mark.asyncio
async def test_build_prompt_balances_spectra_and_trims_when_needed(session_factory: async_sessionmaker[AsyncSession]) -> None:
    spectra = ["center", "center", "rechts", "links", "alternatief"]
    long_stub = "Dit is een uitgebreide paragraaf die wordt herhaald voor prompt trimming. " * 20
    event_id = await _seed_event(session_factory, spectra=spectra, content_stub=long_stub)
    # Use 10000 chars to accommodate expanded template (Epic 9 country detection)
    settings = Settings(llm_prompt_article_cap=5, llm_prompt_max_characters=10000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    prompt = await builder.build_prompt(event_id)

    # Expect spectrum labels to appear in the untrimmed prompt
    assert "Spectrum:" in prompt
    assert len(prompt) <= settings.llm_prompt_max_characters

    # Verify trimming routine shortens the selection under a tighter ceiling
    tight_settings = Settings(llm_prompt_article_cap=5, llm_prompt_max_characters=2500)
    tight_builder = PromptBuilder(session_factory=session_factory, settings=tight_settings)
    async with session_factory() as session:
        event = await tight_builder._fetch_event(session, event_id)
        articles = await tight_builder._fetch_articles(session, event_id)
    capsules = tight_builder._build_capsules(articles)
    selected = tight_builder._select_balanced_subset(capsules, limit=tight_settings.llm_prompt_article_cap)
    context = tight_builder._format_event_context(event, selected, total=len(capsules))
    trimmed_block, trimmed_capsules = tight_builder._trim_prompt(selected, context)
    assert len(trimmed_capsules) < len(selected)
    assert trimmed_block


@pytest.mark.asyncio
async def test_missing_article_content_raises_clear_error(session_factory: async_sessionmaker[AsyncSession]) -> None:
    event_id = await _seed_event(session_factory, spectra=["center"], content_stub=None)
    settings = Settings(llm_prompt_article_cap=3, llm_prompt_max_characters=4000)
    builder = PromptBuilder(session_factory=session_factory, settings=settings)

    with pytest.raises(PromptBuilderError) as exc:
        await builder.build_prompt(event_id)

    assert "verrijkingsstap" in str(exc.value)


def _article(guid: str, content: str, **extra) -> Article:
    moment = datetime(2026, 10, 8, 18, 0, tzinfo=timezone.utc)
    return Article(
        guid=guid,
        url=f"https://example.com/{guid}",
        title=f"Artikel {guid}",
        content=content,
        source_name="Bron",
        source_metadata=extra.pop("source_metadata", {"spectrum": "rechts"}),
        published_at=moment,
        fetched_at=moment,
        **extra,
    )


def test_the_analysis_reads_the_text_after_the_first_sentences() -> None:
    """Event 8786: the precedent was in the eleventh sentence, which the analysis never saw."""
    opening = "Het presidium trok de toestemming in. " * 10
    builder = PromptBuilder(settings=Settings())
    article = _article("nr", opening + "Eerder stemde de Kamer over de Oekraiense vlag.")

    block = builder._format_article_capsules(builder._build_capsules([article]))

    assert "Oekraiense vlag" in block
    assert "Kernpunten" not in block


def test_a_long_text_stops_at_a_sentence_end() -> None:
    from backend.app.llm.prompt_builder import ARTICLE_TEXT_CHAR_LIMIT, _clip_text

    text = "Dit is een zin van het artikel. " * 400

    clipped = _clip_text(text)

    assert len(clipped) <= ARTICLE_TEXT_CHAR_LIMIT + 4
    assert clipped.endswith("artikel. […]")
    assert _clip_text("Kort.") == "Kort."


def test_texts_share_the_room_of_the_prompt() -> None:
    from backend.app.llm.prompt_builder import _text_level

    # Event 11671: three articles, one of 5,366 characters: all read whole
    assert _text_level([1535, 3302, 5366], budget=64000) == 12000
    # Sixteen long ones: 4,000 each, as before
    assert _text_level([9000] * 16, budget=64000) == 4000
    # Short ones leave their room to the long ones
    assert _text_level([1000] * 8 + [20000] * 8, budget=64000) == 7000
    assert _text_level([], budget=64000) == 12000


def test_a_news_item_with_few_articles_is_read_whole() -> None:
    """Event 11671: the chairman of the mosque board spoke after the 4,000th character, so the
    analysis called the board "niet aan het woord"."""
    from backend.app.llm.prompt_builder import CLIP_NOTE

    builder = PromptBuilder(settings=Settings())
    long = _capsule(1, "NieuwRechts", hours_ago=1)
    long.body = "De moskee is aangesloten bij Diyanet. " * 130 + "Voorzitter Çelik zegt dat de gemeenschap blij is."
    short = _capsule(2, "Trouw", hours_ago=2)
    short.body = "De architect vertelt over zijn ontwerp."

    block = builder._format_article_capsules(builder._select_balanced_subset([long, short], limit=16))

    assert len(long.body) > 4000
    assert "Voorzitter Çelik" in block
    assert "Tekst (ingekort)" not in block
    assert CLIP_NOTE not in block


def test_a_clipped_text_says_so() -> None:
    from backend.app.llm.prompt_builder import ARTICLE_TEXT_MAX_CHARS, CLIP_NOTE

    builder = PromptBuilder(settings=Settings())
    longread = _capsule(1, "De Groene", hours_ago=1)
    longread.body = "Dit is een zin van het lange verhaal. " * 500 + "De wethouder reageert aan het slot."
    short = _capsule(2, "Trouw", hours_ago=2)
    short.body = "Een kort bericht."

    block = builder._format_article_capsules(builder._select_balanced_subset([longread, short], limit=16))

    assert len(longread.text) <= ARTICLE_TEXT_MAX_CHARS + 4
    assert "De wethouder reageert" not in block
    assert "   Tekst (ingekort):\n" in block and "   Tekst:\n    Een kort bericht." in block
    assert block.startswith(CLIP_NOTE)


def test_a_find_without_text_does_not_stop_the_analysis() -> None:
    """A find of Zoek met AI counts with its digest; an article without any text is left out
    (event 8786 stayed at 5 of 17 articles because one find had no text)."""
    builder = PromptBuilder(settings=Settings())
    articles = [
        _article("tekst", "De SGP maakte bezwaar tegen de vlag."),
        _article(
            "voice",
            "",
            source_metadata={"digest": {"nl": "De griffie legt de regels voor vlaggen uit."}},
        ),
        _article("leeg", ""),
    ]

    capsules = builder._build_capsules(articles)

    assert [c.title for c in capsules] == ["Artikel tekst", "Artikel voice"]
    assert capsules[1].text == "De griffie legt de regels voor vlaggen uit."
    with pytest.raises(PromptBuilderError, match="verrijkingsstap"):
        builder._build_capsules([_article("leeg", "")])


def _capsule(
    article_id: int,
    source: str,
    *,
    hours_ago: int,
    spectrum: str = "center",
    international: bool = False,
):
    from backend.app.llm.prompt_builder import ArticleCapsule

    moment = datetime(2026, 10, 6, 21, 0, tzinfo=timezone.utc) - timedelta(hours=hours_ago)
    return ArticleCapsule(
        article_id=article_id,
        title=f"Artikel {article_id}",
        url=f"https://example.com/{article_id}",
        spectrum=spectrum,
        source_name=source,
        source_type="private_media",
        published_at=moment,
        fetched_at=moment,
        summary="",
        text="",
        entities=[],
        is_international=international,
        source_country="US" if international else None,
    )


def test_dutch_outlets_are_not_pushed_out_by_foreign_headlines() -> None:
    """Event 7807 (2026-10-06): eight newer Google News headlines took every place of the prompt."""
    builder = PromptBuilder(settings=Settings(llm_prompt_article_cap=8))
    dutch = [
        _capsule(1, "De Telegraaf", hours_ago=12, spectrum="center-right"),
        _capsule(2, "RTL Nieuws", hours_ago=11),
        _capsule(3, "AD", hours_ago=1),
    ]
    foreign = [
        _capsule(10 + i, f"Buitenland {i}", hours_ago=0, international=True) for i in range(8)
    ]

    selected = builder._select_balanced_subset(dutch + foreign, limit=8)

    assert len(selected) == 8
    dutch_names = {c.source_name for c in selected if not c.is_international}
    assert dutch_names == {"De Telegraaf", "RTL Nieuws", "AD"}
    assert len([c for c in selected if c.is_international]) == 5


def test_every_dutch_outlet_before_a_second_article_of_one() -> None:
    builder = PromptBuilder(settings=Settings(llm_prompt_article_cap=3))
    capsules = [_capsule(i, "NOS", hours_ago=i) for i in range(1, 6)] + [
        _capsule(20, "NU.nl", hours_ago=30),
        _capsule(21, "De Volkskrant", hours_ago=40, spectrum="links"),
    ]

    selected = builder._select_balanced_subset(capsules, limit=3)

    assert sorted(c.source_name for c in selected) == ["De Volkskrant", "NOS", "NU.nl"]
    # The newest NOS article represents NOS
    assert [c.article_id for c in selected if c.source_name == "NOS"] == [1]


def test_keeps_room_for_foreign_outlets_when_dutch_ones_would_fill_the_prompt() -> None:
    builder = PromptBuilder(settings=Settings(llm_prompt_article_cap=8))
    spectra = ["links", "center", "rechts", "center-left", "center-right"]
    dutch = [
        _capsule(i, f"Bron {i}", hours_ago=i, spectrum=spectra[i % len(spectra)]) for i in range(10)
    ]
    foreign = [
        _capsule(50 + i, f"Buitenland {i}", hours_ago=i, international=True) for i in range(3)
    ]

    selected = builder._select_balanced_subset(dutch + foreign, limit=8)

    assert len([c for c in selected if c.is_international]) == 2
    dutch_selected = [c for c in selected if not c.is_international]
    assert len(dutch_selected) == 6
    # Spread over the spectrum: every side is there
    assert {c.spectrum for c in dutch_selected} == set(spectra)


# Zelfde tekst (Story 14.27): one text at more outlets is read once
SHARED = (
    "Acteur Cees Geel is in juli op 67-jarige leeftijd overleden na een kort ziekbed. "
    "AvroTros eert hem met een fragment aan het begin van het nieuwe seizoen van Flikken Rotterdam. "
    "Geel speelde vanaf het eerste seizoen de rol van rechercheur Bram Kamphuis in de serie. "
    "De omroep zegt dat de makers lang hebben nagedacht over een passend afscheid van de acteur."
)
AD_OWN = (
    "Producent Pieter Kuijpers vertelt dat de cast het nieuws op de set te horen kreeg en dat de "
    "opnames een dag zijn stilgelegd. Collega Victor Löw noemt Geel een gulle tegenspeler die altijd "
    "tijd had voor jonge acteurs en hun vragen over het vak."
)
RTL_OWN = "Het nieuwe seizoen begint op zondag 26 oktober op NPO 1."


def _copy_capsule(article_id: int, outlet: str, text: str, *, hours_ago: int, group: str | None = "7", **copy):
    from backend.app.llm.prompt_builder import CopyInfo

    capsule = _capsule(article_id, outlet, hours_ago=hours_ago)
    capsule.text = text
    capsule.copy = CopyInfo(group=group, **copy) if group else None
    return capsule


def test_a_text_of_more_outlets_takes_one_place() -> None:
    """Cees Geel (2026-10-19): RTL Nieuws, AD and De Telegraaf brought one ANP text and took three
    of the places; the analysis wrote "volgens De Telegraaf" about what all three brought."""
    from backend.app.llm.prompt_builder import COPY_NOTE

    builder = PromptBuilder(settings=Settings(llm_prompt_article_cap=3))
    capsules = [
        _copy_capsule(1, "De Telegraaf", SHARED, hours_ago=1, source="persbureau", likely_agency="ANP"),
        _copy_capsule(2, "AD", f"{AD_OWN} {SHARED}", hours_ago=2, source="persbureau", likely_agency="ANP"),
        _copy_capsule(3, "RTL Nieuws", f"{SHARED} {RTL_OWN}", hours_ago=3, source="persbureau", likely_agency="ANP"),
        _copy_capsule(4, "NOS", "De NOS sprak met kijkers over de serie.", hours_ago=4, group=None),
        _copy_capsule(5, "NU.nl", "NU.nl blikt terug op de carrière van Geel.", hours_ago=5, group=None),
    ]

    selected = builder._select_balanced_subset(capsules, limit=3)
    block = builder._format_article_capsules(selected)

    # The Telegraaf text once, AD with its own sentences on a place, RTL with one sentence on none
    assert [c.source_name for c in selected] == ["De Telegraaf", "AD", "RTL Nieuws", "NOS"]
    assert block.startswith(COPY_NOTE)
    assert block.count("Geel speelde vanaf het eerste seizoen") == 1
    assert "Zelfde tekst als AD (artikel 2) en RTL Nieuws (artikel 3): persbureautekst (vermoedelijk ANP)" in block
    assert "Tekst die ook bij AD en RTL Nieuws staat:" in block
    assert "Eigen tekst van AD (de rest staat bij artikel 1):" in block
    assert "Collega Victor Löw noemt Geel" in block
    assert "Eigen tekst van RTL Nieuws (de rest staat bij artikel 1):" in block
    assert RTL_OWN in block


def test_a_copy_without_sentences_of_its_own_is_one_line() -> None:
    from backend.app.db.models import Event

    builder = PromptBuilder(settings=Settings())
    capsules = [
        _copy_capsule(1, "RTL Nieuws", f"{SHARED} {RTL_OWN}", hours_ago=1, source="persbureau", agency="ANP"),
        _copy_capsule(2, "De Telegraaf", SHARED, hours_ago=2, source="persbureau", agency="ANP"),
    ]

    selected = builder._select_balanced_subset(capsules, limit=1)
    block = builder._format_article_capsules(selected)
    context = builder._format_event_context(Event(title="Cees Geel", spectrum_distribution={}), selected, total=2)

    # The copy takes no place
    assert [c.source_name for c in selected] == ["RTL Nieuws", "De Telegraaf"]
    assert "Zelfde tekst als De Telegraaf (artikel 2): ANP-tekst" in block
    assert "Eigen tekst van RTL Nieuws:\n    " + RTL_OWN in block
    assert "Tekst: dezelfde als bij artikel 1, zonder eigen zinnen" in block
    assert "- Zelfde tekst bij RTL Nieuws en De Telegraaf: ANP-tekst" in context


def test_a_copy_alone_in_the_prompt_reads_as_any_article() -> None:
    from backend.app.llm.prompt_builder import COPY_NOTE

    builder = PromptBuilder(settings=Settings())
    capsules = [
        _copy_capsule(1, "De Telegraaf", SHARED, hours_ago=1, source="persbureau"),
        # Enough of its own for a place, and there is none left
        _copy_capsule(2, "AD", f"{AD_OWN} {SHARED}", hours_ago=2, source="persbureau"),
    ]

    selected = builder._select_balanced_subset(capsules, limit=1)
    block = builder._format_article_capsules(selected)

    assert [c.source_name for c in selected] == ["De Telegraaf"]
    assert COPY_NOTE not in block
    assert "Zelfde tekst" not in block
    assert "   Tekst:\n    Acteur Cees Geel" in block


@pytest.mark.asyncio
async def test_the_analysis_takes_the_copy_groups_of_the_links(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.app.llm import prompt_builder

    async def file_template(key: str, fallback: str) -> str:
        return fallback

    monkeypatch.setattr(prompt_builder, "_get_prompt_from_db", file_template)
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        event = Event(slug="cees-geel", title="Cees Geel", first_seen_at=now, last_updated_at=now, article_count=3)
        session.add(event)
        await session.flush()
        texts = {"RTL Nieuws": f"{SHARED} {RTL_OWN}", "De Telegraaf": SHARED, "NOS": "De NOS sprak met kijkers."}
        for idx, (outlet, text) in enumerate(texts.items(), start=1):
            article = Article(
                guid=f"geel-{idx}",
                url=f"https://example.com/geel-{idx}",
                title=f"Cees Geel {idx}",
                content=text,
                source_name=outlet,
                source_metadata={"spectrum": "mainstream"},
                published_at=now - timedelta(hours=idx),
                fetched_at=now - timedelta(hours=idx),
            )
            session.add(article)
            await session.flush()
            breakdown: dict = {"hybrid": 0.9}
            if outlet != "NOS":
                breakdown["copy"] = {"v": 2, "group": 0, "share": 0.9, "source": "persbureau", "agency": "ANP"}
            session.add(EventArticle(event_id=event.id, article_id=article.id, similarity_score=0.9, scoring_breakdown=breakdown))
        await session.commit()
        event_id = event.id
    builder = PromptBuilder(session_factory=session_factory, settings=Settings())

    package = await builder.build_factual_prompt_package(event_id, max_articles=2)

    # Two places: RTL Nieuws and NOS; the Telegraaf copy is in the analysis without one
    assert package.selected_count == 3
    assert package.prompt.count("Geel speelde vanaf het eerste seizoen") == 1
    assert "Zelfde tekst als De Telegraaf (artikel 2): ANP-tekst" in package.prompt
    assert "- Zelfde tekst bij RTL Nieuws en De Telegraaf: ANP-tekst" in package.prompt


def test_a_copy_of_a_passage_the_prompt_does_not_show_is_read_whole() -> None:
    """Macron (2026-10-19): the liveblog of De Telegraaf has the ANP text of RTL Nieuws after the
    part the analysis reads, so RTL Nieuws keeps its whole text."""
    from backend.app.llm.prompt_builder import _clip_text

    builder = PromptBuilder(settings=Settings())
    blog = _copy_capsule(1, "De Telegraaf", "", hours_ago=1, source="persbureau", share=0.1)
    # Longer than the room of this prompt: the ANP text at its end is not shown
    blog.body = "De politie zette in de nacht traangas in bij de rellen in Parijs. " * 250 + SHARED
    blog.text = _clip_text(blog.body)
    capsules = [blog, _copy_capsule(2, "RTL Nieuws", SHARED, hours_ago=2, source="persbureau", share=0.9)]

    selected = builder._select_balanced_subset(capsules, limit=3)
    block = builder._format_article_capsules(selected)

    assert [c.source_name for c in selected] == ["De Telegraaf", "RTL Nieuws"]
    assert "Zelfde tekst als RTL Nieuws (artikel 2): persbureautekst, die dit artikel naast veel eigen tekst bevat" in block
    assert "Zelfde tekst als De Telegraaf (artikel 1): persbureautekst\n" in block
    assert "   Tekst:\n    Acteur Cees Geel" in block
    assert "de rest staat bij" not in block


def test_the_analysis_reads_the_links_of_an_article() -> None:
    """Story 14.30: an article that links the Kamerstuk its claim comes from names a source."""
    from backend.app.llm.prompt_builder import LINK_NOTE, PROMPT_LINKS_PER_ARTICLE

    builder = PromptBuilder(settings=Settings())
    kamerstuk = "https://zoek.officielebekendmakingen.nl/kst-32043-628.pdf"
    posts = [f"https://x.com/iemand/status/{i}" for i in range(6)]
    linked = _article(
        "links",
        "De landsadvocaat vond invaren te zwak onderbouwd.",
        source_metadata={"spectrum": "rechts", "links": [*posts, kamerstuk]},
    )
    plain = _article("plain", "Het pensioenfonds reageert niet.")

    capsules = builder._build_capsules([linked, plain])
    block = builder._format_article_capsules(capsules)

    # The document of a public body first, at most five
    assert capsules[0].links[0] == kamerstuk
    assert len(capsules[0].links) == PROMPT_LINKS_PER_ARTICLE
    assert block.startswith(LINK_NOTE)
    assert f"   Links in de tekst: {kamerstuk}; {posts[0]}" in block
    assert block.count("Links in de tekst: ") == 1 + 1  # the note and one article
    assert capsules[1].links == []


def test_no_link_note_without_links() -> None:
    from backend.app.llm.prompt_builder import LINK_NOTE

    builder = PromptBuilder(settings=Settings())
    block = builder._format_article_capsules(builder._build_capsules([_article("a", "Tekst.")]))
    assert LINK_NOTE not in block


@pytest.mark.asyncio
async def test_the_analysis_reads_quotes_from_a_press_release(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Story 14.34: a quote that stands word for word in a Rijksoverheid release comes from it."""
    from backend.app.db.models import EventDocument
    from backend.app.llm import prompt_builder
    from backend.app.llm.prompt_builder import PRESS_NOTE

    async def file_template(key: str, fallback: str) -> str:
        return fallback

    monkeypatch.setattr(prompt_builder, "_get_prompt_from_db", file_template)
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        event = Event(slug="roofkunst", title="Roofkunst", first_seen_at=now, last_updated_at=now, article_count=2)
        session.add(event)
        await session.flush()
        ids = []
        for idx, outlet in enumerate(("NOS", "Trouw"), start=1):
            article = Article(
                guid=f"roof-{idx}",
                url=f"https://example.com/roof-{idx}",
                title=f"Teruggave {idx}",
                content="Nederland geeft twintig voorwerpen terug aan Indonesië.",
                source_name=outlet,
                source_metadata={"spectrum": "mainstream"},
                published_at=now - timedelta(hours=idx),
                fetched_at=now - timedelta(hours=idx),
            )
            session.add(article)
            await session.flush()
            ids.append(article.id)
            session.add(EventArticle(event_id=event.id, article_id=article.id, similarity_score=0.9))
        session.add(
            EventDocument(
                event_id=event.id,
                term="",
                source="persbericht",
                doc_type="Persbericht",
                title="Collectiestukken terug naar Indonesië",
                url="https://www.rijksoverheid.nl/actueel/nieuws/2026/10/09/collectiestukken",
                published_at=now - timedelta(hours=3),
                location="Ministerie van Onderwijs, Cultuur en Wetenschap",
                details={"quoted_by": [{"article_id": ids[0], "outlet": "NOS", "quotes": ["Deze objecten hebben een grote waarde"], "share": 0.0}]},
            )
        )
        await session.commit()
        event_id = event.id
    builder = PromptBuilder(session_factory=session_factory, settings=Settings())

    package = await builder.build_factual_prompt_package(event_id)

    assert PRESS_NOTE in package.prompt
    assert (
        '   Uit het persbericht: persbericht van Ministerie van Onderwijs, Cultuur en Wetenschap, '
        '"Collectiestukken terug naar Indonesië": citaten “Deze objecten hebben een grote waarde”'
    ) in package.prompt
    assert package.prompt.count("   Uit het persbericht: ") == 1


def test_press_line_names_the_share_of_own_text() -> None:
    from backend.app.llm.prompt_builder import _press_line

    line = _press_line("Wederopbouw Syrië", None, {"quotes": [], "share": 0.472})
    assert line == 'persbericht van de Rijksoverheid, "Wederopbouw Syrië": 47 % van de eigen tekst'
    assert _press_line("Titel", "BZ", {"quotes": [], "share": 0.01}) == 'persbericht van BZ, "Titel"'
