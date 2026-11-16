# ruff: noqa: S101
"""Waar speelt het nieuws? (Story 14.38): places of a news item, without AI.

Every error class of the measurement (2026-11-16) has a test: namesakes, Dutch hamlets with a
foreign name, places inside a longer name, multi-word names spaCy cuts in two, stories with many
places, small villages without a preposition.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from backend.app.db.models import Article, EventArticle, EventPlace
from backend.app.nlp.gazetteer import Gazetteer, get_gazetteer
from backend.app.services.event_places import (
    ArticlePlaceInput,
    EventPlacesService,
    places_for_event,
)
from backend.tests.unit._exploration_fixtures import (
    SeedArticle,
    make_session_factory,
    make_settings,
    seed_event,
)

# A small place list in the format of places.json: [id, name, cc, lat, lon, pop, kind, region]
PLACES = [
    [1, "Amsterdam", "NL", 52.37, 4.89, 741636, "P", "Noord-Holland"],
    [2, "Gemeente Amsterdam", "NL", 52.37, 4.9, 854047, "M", "Noord-Holland"],
    [3, "Californië", "NL", 51.4, 6.0, 0, "P", "Limburg"],
    [4, "Californië", "US", 36.7, -119.4, 0, "R", None],
    [5, "Newcastle", "AU", -32.9, 151.7, 508437, "C", "Nieuw-Zuid-Wales"],
    [6, "Newcastle", "ZA", -27.7, 29.9, 404838, "C", "KwaZulu-Natal"],
    [7, "Hoorn", "NL", 52.64, 5.06, 68852, "P", "Noord-Holland"],
    [8, "Tel Aviv", "IL", 32.08, 34.78, 432892, "C", "Tel Aviv"],
    [9, "Pieterburen", "NL", 53.4, 6.45, 295, "P", "Groningen"],
    [10, "Best", "NL", 51.5, 5.39, 29074, "P", "Noord-Brabant"],
    [11, "Valencia", "ES", 39.47, -0.38, 814208, "C", "Valencia"],
    [12, "Valencia", "VE", 10.16, -68.0, 1385202, "C", "Carabobo"],
    [13, "Den Haag", "NL", 52.08, 4.3, 474292, "P", "Zuid-Holland"],
    [14, "Parijs", "FR", 48.85, 2.35, 2138551, "C*", "Île-de-France"],
    [15, "Lyon", "FR", 45.75, 4.85, 522969, "C", "Auvergne"],
    [16, "Rouen", "FR", 49.44, 1.1, 110145, "C", "Normandië"],
    [17, "Koggenland", "NL", 52.64, 4.95, 22940, "M", "Noord-Holland"],
    [18, "Leerdam", "NL", 51.89, 5.09, 21000, "P", "Utrecht"],
    [19, "Zeeland", "NL", 51.7, 5.67, 2000, "P", "Noord-Brabant"],
    [20, "Zeeland", "NL", 51.5, 3.8, 385000, "R", None],
]
NAMES = {
    "amsterdam": [0, 1],
    "gemeente-amsterdam": [1],
    "californie": [2, 3],
    "newcastle": [4, 5],
    "hoorn": [6],
    "tel-aviv": [7],
    "pieterburen": [8],
    "best": [9],
    "valencia": [10, 11],
    "den-haag": [12],
    "parijs": [13],
    "lyon": [14],
    "rouen": [15],
    "koggenland": [16],
    "leerdam": [17],
    "zeeland": [18, 19],
    "spanje": ["c:ES"],
    "frankrijk": ["c:FR"],
    "nederland": ["c:NL"],
    "israel": ["c:IL"],
    "dam": [0],
}
COUNTRIES = {
    "ES": {"name": "Spanje", "lat": 40.4, "lon": -3.7},
    "FR": {"name": "Frankrijk", "lat": 48.85, "lon": 2.35},
    "NL": {"name": "Nederland", "lat": 52.37, "lon": 4.89},
    "IL": {"name": "Israël", "lat": 31.77, "lon": 35.22},
}
EXTRA = {"never": ["dam"], "needs_preposition": ["best"]}


@pytest.fixture()
def gazetteer() -> Gazetteer:
    return Gazetteer({"places": PLACES, "names": NAMES, "countries": COUNTRIES}, EXTRA)


def gpe(text: str, lead: str, label: str = "GPE") -> dict:
    start = lead.index(text)
    return {"text": text, "label": label, "start": start, "end": start + len(text)}


def article(title: str, lead: str, *names: str, label: str = "GPE") -> ArticlePlaceInput:
    return ArticlePlaceInput(
        title=title, lead=lead, entities=[gpe(name, lead, label) for name in names]
    )


def names(found) -> list[str]:
    return [item.place.name for item in found]


def test_town_wins_from_its_municipality(gazetteer):
    lead = "In Amsterdam is vannacht een brand uitgebroken."
    found = places_for_event([article("Brand in woning", lead, "Amsterdam")], gazetteer=gazetteer)
    assert names(found) == ["Amsterdam"]
    assert found[0].place.key == "place:1"
    assert found[0].place.kind == "place"


def test_municipality_when_no_town_has_the_name(gazetteer):
    lead = "In Koggenland stemde de gemeenteraad in met het plan."
    found = places_for_event([article("Plan aangenomen", lead, "Koggenland")], gazetteer=gazetteer)
    assert names(found) == ["Koggenland"]


def test_mention_after_the_lead_does_not_count(gazetteer):
    lead = "x" * 450 + " Amsterdam"
    found = places_for_event([article("Iets", lead, "Amsterdam")], gazetteer=gazetteer)
    assert found == []


def test_dutch_hamlet_loses_from_foreign_region(gazetteer):
    lead = "In Californië woeden opnieuw bosbranden."
    found = places_for_event([article("Bosbranden", lead, "Californië")], gazetteer=gazetteer)
    assert found[0].place.iso_code == "US"


def test_city_in_a_country_the_news_names_wins(gazetteer):
    lead = "Spanje rouwt: in Valencia vielen tientallen doden door de overstromingen."
    found = places_for_event(
        [article("Overstromingen", lead, "Spanje", "Valencia")], gazetteer=gazetteer
    )
    assert names(found) == ["Valencia"]
    assert found[0].place.iso_code == "ES"  # not Venezuela (bigger), and Spanje itself goes


def test_without_context_the_biggest_city(gazetteer):
    lead = "In Newcastle viel vannacht een man van een brug."
    found = places_for_event([article("Val van brug", lead, "Newcastle")], gazetteer=gazetteer)
    assert found[0].place.iso_code == "AU"


def test_place_inside_a_longer_name_does_not_count(gazetteer):
    lead = "De Hoorn van Afrika kampt met droogte."
    found = places_for_event([article("Droogte", lead, "Hoorn")], gazetteer=gazetteer)
    assert found == []


def test_multi_word_name_spacy_cut_in_two(gazetteer):
    lead = "In Tel Aviv gingen duizenden de straat op."
    found = places_for_event([article("Protest", lead, "Aviv")], gazetteer=gazetteer)
    assert names(found) == ["Tel Aviv"]


def test_small_village_needs_a_preposition(gazetteer):
    without = "Pieterburen zag dit jaar meer zeehonden."
    with_prep = "Bij het zeehondencentrum in Pieterburen liggen veertig zeehonden."
    assert (
        places_for_event([article("Zeehonden", without, "Pieterburen")], gazetteer=gazetteer) == []
    )
    found = places_for_event([article("Zeehonden", with_prep, "Pieterburen")], gazetteer=gazetteer)
    assert names(found) == ["Pieterburen"]


def test_place_that_is_a_word_needs_a_preposition(gazetteer):
    lead = "Best is wat je doet, zegt de trainer. Later meer in Best."
    word = {"text": "Best", "label": "GPE", "start": 0, "end": 4}
    place = {"text": "Best", "label": "GPE", "start": lead.rindex("Best"), "end": len(lead) - 1}
    assert (
        places_for_event(
            [ArticlePlaceInput(title="Trainer", lead=lead, entities=[word])], gazetteer=gazetteer
        )
        == []
    )
    found = places_for_event(
        [ArticlePlaceInput(title="Trainer", lead=lead, entities=[place])], gazetteer=gazetteer
    )
    assert names(found) == ["Best"]


def test_never_list_and_lowercase(gazetteer):
    lead = "Op de Dam stonden duizenden mensen; amsterdam bleef rustig."
    found = places_for_event([article("Herdenking", lead, "Dam", "amsterdam")], gazetteer=gazetteer)
    assert found == []


def test_the_netherlands_is_no_place(gazetteer):
    lead = "Nederland stuurt hulp."
    assert places_for_event([article("Hulp", lead, "Nederland")], gazetteer=gazetteer) == []


def test_place_in_the_headline_counts(gazetteer):
    # De Telegraaf: the text does not start with the headline
    found = places_for_event(
        [
            ArticlePlaceInput(
                title="Grote brand in Den Haag", lead="Een woning brandde uit.", entities=[]
            )
        ],
        gazetteer=gazetteer,
    )
    assert names(found) == ["Den Haag"]
    assert found[0].in_title


def test_one_headline_word_needs_a_preposition_or_the_text(gazetteer):
    # "Van Dijk", "Janet Jackson": one capitalised word in a headline is mostly a name
    alone = ArticlePlaceInput(title="Amsterdam verbiedt rookworsten", lead="", entities=[])
    assert places_for_event([alone], gazetteer=gazetteer) == []
    after = ArticlePlaceInput(title="Rookworstverbod in Amsterdam", lead="", entities=[])
    assert names(places_for_event([after], gazetteer=gazetteer)) == ["Amsterdam"]
    lead = "De gemeente Amsterdam verbiedt de verkoop."
    confirmed = article("Amsterdam verbiedt rookworsten", lead, "Amsterdam")
    found = places_for_event([confirmed], gazetteer=gazetteer)
    assert names(found) == ["Amsterdam"] and found[0].in_title


def test_first_word_of_a_headline_needs_a_big_place(gazetteer):
    small = article(
        "Pieterburen telt meer zeehonden", "In Pieterburen liggen er veertig.", "Pieterburen"
    )
    found = places_for_event([small], gazetteer=gazetteer)
    assert (
        names(found) == ["Pieterburen"] and not found[0].in_title
    )  # from the text, not the headline


def test_half_of_the_articles_must_name_it(gazetteer):
    with_place = article("Brand", "In Amsterdam brandde een woning.", "Amsterdam")
    other = article("Brand", "Een woning brandde vannacht uit.")
    assert names(places_for_event([with_place, other], gazetteer=gazetteer)) == ["Amsterdam"]
    found = places_for_event([with_place, other, other, other], gazetteer=gazetteer)
    assert found == []  # 1 of 4
    found = places_for_event([with_place, with_place, other, other], gazetteer=gazetteer)
    assert names(found) == ["Amsterdam"]  # 2 of 4


def test_story_with_many_places_keeps_only_headline_places(gazetteer):
    lead = "Van Parijs tot Lyon en Rouen, en ook in Amsterdam: het bouillonrestaurant rukt op."
    many = article("Frans eten voor weinig", lead, "Parijs", "Lyon", "Rouen", "Amsterdam")
    assert places_for_event([many], gazetteer=gazetteer) == []
    titled = article("Bouillon verovert Lyon", lead, "Parijs", "Lyon", "Rouen", "Amsterdam")
    assert names(places_for_event([titled], gazetteer=gazetteer)) == ["Lyon"]


def test_a_state_wins_from_a_smaller_city_elsewhere():
    places = [
        [1, "Virginia", "ZA", -28.1, 26.86, 120000, "C", "Free State"],
        [2, "Virginia", "US", 37.5, -78.8, 0, "R", None],
    ]
    small = Gazetteer({"places": places, "names": {"virginia": [0, 1]}, "countries": {}}, {})
    lead = "In Virginia is de gouverneur herkozen."
    found = places_for_event([article("Verkiezing", lead, "Virginia")], gazetteer=small)
    assert found[0].place.iso_code == "US"


def test_country_and_capital_need_a_preposition_of_place(gazetteer):
    # They also stand for their government: "Frankrijk wil", "Parijs eist"
    subject = article(
        "Frankrijk wil strengere regels", "Frankrijk wil strengere regels.", "Frankrijk"
    )
    assert places_for_event([subject], gazetteer=gazetteer) == []
    capital = article("Parijs eist opheldering", "Parijs eist opheldering van Brussel.", "Parijs")
    assert places_for_event([capital], gazetteer=gazetteer) == []
    there = article("Staking in Parijs", "In Parijs staken de vuilnismannen.", "Parijs")
    assert names(places_for_event([there], gazetteer=gazetteer)) == ["Parijs"]


def test_name_followed_by_a_capitalised_word_in_a_headline(gazetteer):
    title = ArticlePlaceInput(
        title="VS en Rusland praten, meldt Den Haag Centraal", lead="", entities=[]
    )
    assert places_for_event([title], gazetteer=gazetteer) == []


def test_country_goes_when_a_place_in_it_stays(gazetteer):
    lead = "Israël: in Tel Aviv protesteren duizenden."
    found = places_for_event([article("Protest", lead, "Israël", "Tel Aviv")], gazetteer=gazetteer)
    assert names(found) == ["Tel Aviv"]
    only_country = article("Verkiezingen in Israël", "Israël kiest een nieuw parlement.", "Israël")
    found = places_for_event([only_country], gazetteer=gazetteer)
    assert [f.place.key for f in found] == ["country:il"]


def test_name_beside_another_capitalised_word_is_a_person_or_club(gazetteer):
    lead = "Jutta Leerdam mist dit seizoen haar rivale bij de wereldbeker in Amsterdam."
    found = places_for_event(
        [article("Kok mist rivale Leerdam", lead, "Leerdam", "Amsterdam")], gazetteer=gazetteer
    )
    assert names(found) == ["Amsterdam"]


def test_surname_with_a_particle_is_no_place(gazetteer):
    lead = "In de finale won Michael van Hoorn van zijn rivaal."
    assert places_for_event([article("Finale", lead, "Hoorn")], gazetteer=gazetteer) == []
    title = ArticlePlaceInput(title="Bert van Hoorn stopt", lead="", entities=[])
    assert places_for_event([title], gazetteer=gazetteer) == []


def test_a_place_that_needs_more_than_a_mention(gazetteer):
    # Named early but never after "in", "te", "bij", "op" and not in a headline: the subject of
    # the news, not where it happens ("Rusland valt aan", "VS koopt diesel")
    lead = "Amsterdam wil minder toeristen, zegt de wethouder."
    assert (
        places_for_event([article("Minder toeristen", lead, "Amsterdam")], gazetteer=gazetteer)
        == []
    )
    late = "x" * 200 + " Daarna kwam de brandweer in Amsterdam."
    assert places_for_event([article("Brand", late, "Amsterdam")], gazetteer=gazetteer) == []


def test_where_someone_comes_from_is_no_place(gazetteer):
    lead = "Een vrouw uit Amsterdam heeft de loterij gewonnen."
    assert places_for_event([article("Winnares", lead, "Amsterdam")], gazetteer=gazetteer) == []


def test_sports_news_has_no_places(gazetteer):
    lead = "In Valencia won Ajax met 2-1."
    found = places_for_event(
        [article("Ajax wint", lead, "Valencia")], event_type="sports", gazetteer=gazetteer
    )
    assert found == []


def test_province_wins_from_small_village_with_its_name(gazetteer):
    lead = "In Zeeland is het water gestegen."
    found = places_for_event([article("Hoog water", lead, "Zeeland")], gazetteer=gazetteer)
    assert found[0].place.kind == "region"


def test_real_place_list_resolves_known_names():
    gazetteer = get_gazetteer()
    lead = "In Den Haag, Kiev, Newcastle en Sint Maarten gebeurde iets."
    found = places_for_event(
        [
            article("Iets", "In Den Haag gebeurde iets.", "Den Haag"),
            article("Iets", "In Den Haag gebeurde iets.", "Den Haag"),
        ],
        gazetteer=gazetteer,
    )
    assert names(found) == ["Den Haag"]
    keys = {
        name: gazetteer.lookup(slug)[0]
        for name, slug in (
            ("Kiev", "kiev"),
            ("Newcastle", "newcastle"),
            ("Sint Maarten", "sint-maarten"),
        )
    }
    assert keys["Kiev"].iso_code == "UA"
    newcastle = {place.iso_code for place in gazetteer.lookup("newcastle")}
    assert {"GB", "AU"} <= newcastle  # the news item's countries decide
    assert keys["Sint Maarten"].iso_code == "SX"
    assert lead  # the names above are the measured namesakes


# ------------------------------------------------------------------ persistence


@pytest.mark.asyncio
async def test_service_writes_updates_and_deletes_rows(gazetteer):
    factory, engine = await make_session_factory()
    try:
        event_id = await seed_event(
            factory,
            slug="brand-amsterdam",
            llm_title="Brand in Amsterdam",
            articles=[SeedArticle("NOS"), SeedArticle("AD")],
        )
        async with factory() as session:
            ids = (
                (
                    await session.execute(
                        select(Article.id)
                        .join(EventArticle)
                        .where(EventArticle.event_id == event_id)
                    )
                )
                .scalars()
                .all()
            )
            for article_id in ids:
                row = await session.get(Article, article_id)
                row.content = "In Amsterdam brandde vannacht een woning."
                row.entities = [{"text": "Amsterdam", "label": "GPE", "start": 3, "end": 12}]
            await session.commit()

        service = EventPlacesService(
            settings=make_settings(), session_factory=factory, gazetteer=gazetteer
        )
        dry = await service.refresh_events([event_id], dry_run=True)
        assert dry.rows_inserted == 1
        async with factory() as session:
            assert (await session.execute(select(EventPlace))).scalars().all() == []

        first = await service.refresh_events([event_id])
        assert (first.rows_inserted, first.events_with_places) == (1, 1)
        async with factory() as session:
            rows = (await session.execute(select(EventPlace))).scalars().all()
        assert [(r.place_key, r.name, r.event_title, r.outlets) for r in rows] == [
            ("place:1", "Amsterdam", "Brand in Amsterdam", ["AD", "NOS"])
        ]

        again = await service.refresh_events([event_id])
        assert (again.rows_inserted, again.rows_updated, again.rows_deleted) == (0, 0, 0)

        async with factory() as session:
            for article_id in ids:
                row = await session.get(Article, article_id)
                row.content = "In Den Haag brandde vannacht een woning."
                row.entities = [{"text": "Den Haag", "label": "GPE", "start": 3, "end": 11}]
            await session.commit()
        moved = await service.refresh_events([event_id])
        assert (moved.rows_inserted, moved.rows_deleted) == (1, 1)
        async with factory() as session:
            keys = (await session.execute(select(EventPlace.place_key))).scalars().all()
        assert keys == ["place:13"]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_service_skips_news_without_analysis_title(gazetteer):
    factory, engine = await make_session_factory()
    try:
        event_id = await seed_event(
            factory, slug="zonder-titel", llm_title=None, articles=[SeedArticle("NOS")]
        )
        service = EventPlacesService(
            settings=make_settings(), session_factory=factory, gazetteer=gazetteer
        )
        result = await service.refresh_events([event_id])
        assert (result.skipped_no_title, result.rows_inserted) == (1, 0)
    finally:
        await engine.dispose()
