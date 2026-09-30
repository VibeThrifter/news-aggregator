# ruff: noqa: S101
"""Tests for canonical entity aggregation per event (Story 11.8)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from backend.app.db.models import Article, EventArticle, EventEntity
from backend.app.nlp.entity_keys import slugify
from backend.app.services.event_entity_service import (
    MAX_ARTICLE_IDS,
    ArticleEntities,
    EventEntityService,
    acronym_matches,
    aggregate,
    latest_titles,
)
from backend.tests.unit._exploration_fixtures import (
    SeedArticle,
    make_session_factory,
    make_settings,
    mention,
    seed_event,
)


def _article(source: str, *mentions: tuple[str, str]) -> ArticleEntities:
    return ArticleEntities(source_name=source, entities=[mention(t, lbl) for t, lbl in mentions])


def _by_key(entities):
    return {entity.entity_key: entity for entity in entities}


async def _article_ids_by_source(factory, event_id: int) -> dict[str, int]:
    async with factory() as session:
        result = await session.execute(
            select(Article.source_name, Article.id)
            .join(EventArticle, EventArticle.article_id == Article.id)
            .where(EventArticle.event_id == event_id)
        )
        return dict(result.all())


def test_label_mapping_drops_noise_labels() -> None:
    result = _by_key(
        aggregate(
            [
                _article(
                    "NOS",
                    ("Mark Rutte", "PERSON"),
                    ("Rijkswaterstaat", "ORG"),
                    ("Utrecht", "GPE"),
                    ("Noordzee", "LOC"),
                    ("Hezbollah", "NORP"),
                    ("maandag", "DATE"),
                    ("drie", "CARDINAL"),
                    ("Prinsjesdag", "EVENT"),
                )
            ]
        )
    )
    assert set(result) == {
        "person:mark-rutte",
        "org:rijkswaterstaat",
        "place:utrecht",
        "place:noordzee",
        "group:hezbollah",
    }


def test_outlets_and_own_sources_are_dropped() -> None:
    result = _by_key(
        aggregate(
            [
                _article("NOS", ("NOS", "ORG"), ("de Volkskrant", "ORG"), ("NU.nl", "GPE")),
                _article("Omroep West", ("Omroep West", "ORG"), ("Reuters", "ORG")),
            ]
        )
    )
    assert result == {}


def test_invalid_mentions_are_ignored() -> None:
    articles = [
        ArticleEntities(
            source_name=None,
            entities=[
                "not-a-mapping",
                mention("2024", "ORG"),
                mention("A", "PERSON"),
                mention("Путин", "PERSON"),
                {"label": "PERSON"},
                {"text": 42, "label": "PERSON"},
                mention("Den Haag", "GPE"),
            ],
        ),
        ArticleEntities(source_name="AD", entities=None),
    ]
    result = aggregate(articles)
    assert [entity.entity_key for entity in result] == ["place:den-haag"]
    assert result[0].outlet_counts == {"onbekend": 1}
    assert aggregate([]) == []


def test_surname_title_and_genitive_merge_into_full_name() -> None:
    result = _by_key(
        aggregate(
            [
                _article(
                    "NOS",
                    ("Donald Trump", "PERSON"),
                    ("Trump", "PERSON"),
                    ("President Trump", "PERSON"),
                    ("Trumps", "PERSON"),
                ),
                _article("AD", ("Trump", "PERSON"), ("Trump", "ORG")),
            ]
        )
    )
    trump = result["person:donald-trump"]
    assert set(result) == {"person:donald-trump"}
    assert trump.name == "Donald Trump"
    assert trump.mention_count == 6
    assert trump.article_count == 2
    assert {"donald-trump", "trump", "trumps"} <= set(trump.aliases)


def test_ambiguous_surname_is_not_merged() -> None:
    result = _by_key(
        aggregate(
            [
                _article(
                    "NOS",
                    ("Donald Trump", "PERSON"),
                    ("Melania Trump", "PERSON"),
                    ("Trump", "PERSON"),
                )
            ]
        )
    )
    assert set(result) == {"person:donald-trump", "person:melania-trump", "person:trump"}


def test_multi_token_suffix_merges_into_longest_name() -> None:
    result = _by_key(
        aggregate(
            [
                _article(
                    "NOS",
                    ("Ursula von der Leyen", "PERSON"),
                    ("Von der Leyen", "PERSON"),
                    ("Leyen", "PERSON"),
                )
            ]
        )
    )
    entity = result["person:ursula-von-der-leyen"]
    assert entity.mention_count == 3
    assert {"von-der-leyen", "leyen"} <= set(entity.aliases)


def test_acronym_merges_into_spelled_out_org() -> None:
    result = _by_key(
        aggregate(
            [
                _article(
                    "NOS",
                    ("RIVM", "ORG"),
                    ("RIVM", "ORG"),
                    ("Rijksinstituut voor Volksgezondheid en Milieu", "ORG"),
                    ("PVV", "ORG"),
                    ("Partij voor de Vrijheid", "ORG"),
                    ("EU", "ORG"),
                    ("Europol", "ORG"),
                )
            ]
        )
    )
    rivm = result["org:rijksinstituut-voor-volksgezondheid-en-milieu"]
    assert rivm.mention_count == 3
    assert rivm.name == "Rijksinstituut voor Volksgezondheid en Milieu"
    assert "rivm" in rivm.aliases
    assert result["org:partij-voor-de-vrijheid"].mention_count == 2
    # a single-token org never absorbs an acronym via inner letters
    assert "org:eu" in result and "org:europol" in result


@pytest.mark.parametrize(
    ("acronym", "name", "expected"),
    [
        ("rivm", "Rijksinstituut voor Volksgezondheid en Milieu", True),
        ("pvv", "Partij voor de Vrijheid", True),
        ("vvd", "Volkspartij voor Vrijheid en Democratie", True),
        ("navo", "Noord-Atlantische Verdragsorganisatie", True),
        ("eu", "Europese Unie", True),
        ("om", "Openbaar Ministerie", True),
        ("eu", "Europol", False),
        ("nos", "Partij voor de Vrijheid", False),
        ("abc", "", False),
        ("", "Europese Unie", False),
    ],
)
def test_acronym_matches(acronym: str, name: str, expected: bool) -> None:
    assert acronym_matches(acronym, slugify(name).split("-")) is expected


def test_country_mapping_and_places() -> None:
    result = _by_key(
        aggregate(
            [
                _article(
                    "NOS",
                    ("Israël", "GPE"),
                    ("Israël", "GPE"),
                    ("Gaza", "GPE"),
                    ("Gaza", "LOC"),
                    ("VS", "GPE"),
                    ("Verenigde Staten", "GPE"),
                    ("Trump", "GPE"),
                )
            ]
        )
    )
    israel = result["country:il"]
    assert israel.kind == "country"
    assert israel.iso_code == "IL"
    assert israel.name == "Israël"
    assert {"il", "israel"} <= set(israel.aliases)
    usa = result["country:us"]
    assert usa.name == "Verenigde Staten"  # longest surface form
    assert {"us", "vs", "verenigde-staten", "united-states"} <= set(usa.aliases)
    assert result["place:gaza"].mention_count == 2  # GPE + LOC unify, cities stay places
    assert "country:ps" not in result
    # person aliases in the mapping ("trump") never turn a place into a country
    assert result["place:trump"].kind == "place"
    assert usa.mention_count == 2


def test_kind_unification_and_demonym_adjectives() -> None:
    result = _by_key(
        aggregate(
            [
                _article(
                    "NOS",
                    ("Hamas", "NORP"),
                    ("Hamas", "NORP"),
                    ("Hamas", "GPE"),
                    ("Amerikaanse", "NORP"),
                    ("Israëlische", "NORP"),
                    ("Palestijnen", "NORP"),
                )
            ]
        )
    )
    assert result["group:hamas"].mention_count == 3
    assert "place:hamas" not in result
    assert "group:amerikaanse" not in result
    assert "group:israelische" not in result
    assert "group:palestijnen" in result


def test_noise_gate_depends_on_event_size() -> None:
    articles = [
        _article("NOS", ("Mark Rutte", "PERSON"), ("Mark Rutte", "PERSON"), ("Eenmalig", "ORG")),
        _article("AD", ("Dick Schoof", "PERSON")),
        _article("RTL Nieuws", ("Dick Schoof", "PERSON")),
    ]
    big = _by_key(aggregate(articles))
    assert set(big) == {"person:mark-rutte", "person:dick-schoof"}  # 2 mentions / 2 articles
    small = _by_key(aggregate(articles[:2]))
    assert "org:eenmalig" in small  # events with <= 2 articles keep everything


def test_outlet_counts_salience_order_and_cap() -> None:
    articles = [
        _article("NOS", ("Mark Rutte", "PERSON"), ("Mark Rutte", "PERSON"), ("Utrecht", "GPE")),
        _article("NU.nl", ("Mark Rutte", "PERSON"), ("Utrecht", "GPE"), ("Ajax", "ORG")),
        _article("NOS", ("Ajax", "ORG")),
    ]
    result = aggregate(articles)
    assert [entity.entity_key for entity in result] == [
        "person:mark-rutte",
        "org:ajax",
        "place:utrecht",
    ]
    rutte = result[0]
    assert rutte.outlet_counts == {"NOS": 2, "NU.nl": 1}
    assert rutte.article_count == 2
    assert rutte.salience == pytest.approx(3 / 7, abs=1e-6)
    assert sum(entity.salience for entity in result) == pytest.approx(1.0, abs=1e-5)
    capped = aggregate(articles, max_entities=1)
    assert [entity.entity_key for entity in capped] == ["person:mark-rutte"]


def test_article_ids_list_the_articles_mentioning_the_entity() -> None:
    articles = [
        ArticleEntities("NOS", [mention("NordVind", "ORG"), mention("Rob Jetten", "PERSON")], 31),
        ArticleEntities("AD", [mention("Rob Jetten", "PERSON")], 7),
        ArticleEntities("NU.nl", [mention("NordVind", "ORG"), mention("Jetten", "PERSON")], 12),
    ]
    result = _by_key(aggregate(articles))
    assert result["org:nordvind"].article_ids == [12, 31]  # 2 of 3 articles, ascending
    assert result["org:nordvind"].article_count == 2
    # merged forms ("Jetten" -> "Rob Jetten") contribute their articles too
    assert result["person:rob-jetten"].article_ids == [7, 12, 31]
    # unknown ids (callers without database ids) are left out; counts still work
    anonymous = aggregate(
        [_article("NOS", ("NordVind", "ORG")), _article("AD", ("NordVind", "ORG"))]
    )
    assert anonymous[0].article_ids == [] and anonymous[0].article_count == 2


def test_article_ids_are_capped_to_the_newest() -> None:
    total = MAX_ARTICLE_IDS + 25
    articles = [
        ArticleEntities("NOS", [mention("NordVind", "ORG")], article_id)
        for article_id in range(total, 0, -1)
    ]
    entity = aggregate(articles)[0]
    assert entity.article_count == total
    assert entity.article_ids == list(range(26, total + 1))  # the newest 200, ascending
    assert len(entity.article_ids) == MAX_ARTICLE_IDS == 200


def test_latest_titles_prefers_newest_insight() -> None:
    now = datetime(2026, 9, 1, tzinfo=timezone.utc)
    rows = [
        (1, "Oude titel van het event\n\nTekst", now - timedelta(days=1)),
        (1, "Nieuwe titel van het event\n\nTekst", now),
        (2, "Geen titel", now.replace(tzinfo=None)),
        (3, "Titel zonder tijd hier\n\nTekst", None),
    ]
    assert latest_titles(rows) == {
        1: "Nieuwe titel van het event",
        2: None,
        3: "Titel zonder tijd hier",
    }


@pytest.mark.asyncio
async def test_service_persists_rows_with_denormalised_fields() -> None:
    factory, engine = await make_session_factory()
    event_id = await seed_event(
        factory,
        slug="kabinet-valt",
        llm_title="Kabinet valt over asiel",
        event_type="politics",
        articles=[
            SeedArticle("NOS", [mention("Dick Schoof", "PERSON"), mention("Den Haag", "GPE")]),
            SeedArticle("AD", [mention("Dick Schoof", "PERSON"), mention("Den Haag", "GPE")]),
            SeedArticle("Reuters", [mention("Joe Biden", "PERSON")] * 5, is_international=True),
        ],
    )
    untitled = await seed_event(
        factory,
        slug="zonder-titel",
        llm_title=None,
        articles=[SeedArticle("NOS", [mention("Dick Schoof", "PERSON")])],
    )
    service = EventEntityService(
        settings=make_settings(),
        read_session_factory=factory,
        write_session_factory=factory,
    )

    result = await service.refresh_events([event_id, untitled, 9999])

    assert result.events_written == [event_id]
    assert result.skipped_no_title == [untitled]
    assert result.missing == [9999]
    assert result.rows_written == 2
    assert sorted(result.entities_by_event[event_id]) == [
        ("person:dick-schoof", "person", "Dick Schoof"),
        ("place:den-haag", "place", "Den Haag"),
    ]
    async with factory() as session:
        rows = (await session.execute(select(EventEntity))).scalars().all()
    assert {row.entity_key for row in rows} == {"person:dick-schoof", "place:den-haag"}
    row = next(r for r in rows if r.entity_key == "person:dick-schoof")
    assert row.event_title == "Kabinet valt over asiel"  # LLM title, never the article title
    assert row.event_slug == "kabinet-valt"
    assert row.event_type == "politics"
    assert row.event_last_updated_at is not None
    assert row.outlet_counts == {"AD": 1, "NOS": 1}
    assert row.aliases == ["dick-schoof", "schoof"]
    ids = await _article_ids_by_source(factory, event_id)
    # the international Reuters article is never part of the entity rows
    assert row.article_ids == sorted([ids["NOS"], ids["AD"]])

    # recomputation replaces rows instead of duplicating them
    again = await service.refresh_events([event_id])
    assert again.rows_written == 2
    async with factory() as session:
        count = len((await session.execute(select(EventEntity))).scalars().all())
    assert count == 2
    await engine.dispose()


@pytest.mark.asyncio
async def test_service_persists_article_ids_of_mentioning_articles() -> None:
    factory, engine = await make_session_factory()
    event_id = await seed_event(
        factory,
        slug="nordvind-failliet",
        llm_title="Windparkbouwer NordVind failliet",
        articles=[
            SeedArticle("NOS", [mention("NordVind", "ORG"), mention("Rob Jetten", "PERSON")]),
            SeedArticle("AD", [mention("Rob Jetten", "PERSON")]),
            SeedArticle("NU.nl", [mention("NordVind", "ORG"), mention("Rob Jetten", "PERSON")]),
        ],
    )
    service = EventEntityService(
        settings=make_settings(),
        read_session_factory=factory,
        write_session_factory=factory,
    )
    await service.refresh_events([event_id])
    ids = await _article_ids_by_source(factory, event_id)
    async with factory() as session:
        rows = {
            row.entity_key: row
            for row in (await session.execute(select(EventEntity))).scalars().all()
        }
    assert rows["org:nordvind"].article_ids == sorted([ids["NOS"], ids["NU.nl"]])
    assert rows["org:nordvind"].article_count == 2
    assert rows["person:rob-jetten"].article_ids == sorted(ids.values())
    await engine.dispose()


@pytest.mark.asyncio
async def test_service_uses_summary_override_for_title() -> None:
    factory, engine = await make_session_factory()
    event_id = await seed_event(
        factory,
        slug="nieuw",
        llm_title=None,
        articles=[SeedArticle("NOS", [mention("Dick Schoof", "PERSON")])],
    )
    service = EventEntityService(
        settings=make_settings(),
        read_session_factory=factory,
        write_session_factory=factory,
    )
    result = await service.refresh_events(
        [event_id], summaries={event_id: "Verse titel uit de hook\n\nTekst"}
    )
    assert result.events_written == [event_id]
    async with factory() as session:
        row = (await session.execute(select(EventEntity))).scalars().one()
    assert row.event_title == "Verse titel uit de hook"
    assert await service.load_inputs([]) == {}
    assert await service.load_inputs([12345]) == {}
    await engine.dispose()
