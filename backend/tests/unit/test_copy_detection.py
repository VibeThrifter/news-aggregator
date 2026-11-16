# ruff: noqa: S101
"""Zelfde tekst (Story 14.27): which articles of one news item are the same text."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import HTTPException

from backend.app.routers import admin
from backend.app.services.copy_detection import (
    MIN_RUN_WORDS,
    CopyArticle,
    article_code,
    copy_payload,
    copy_probability,
    coverage,
    find_copy_groups,
    overlap,
    payloads_for,
    text_print,
)

# An agency text (ANP style): about 90 words, no quotes
AGENCY = (
    "De drie vakantieparken van realityster Peter Gillis die gedwongen in de verkoop gaan, "
    "kunnen ruim 27 miljoen euro opleveren. Dat is het totaalbedrag dat donderdag bij veilingen "
    "is geboden voor de parken, die door schuldeiser Marc van Rooi worden verkocht. Deze "
    "vleesondernemer leende in 2023 miljoenen uit aan het vakantieparkenbedrijf Oostappen Groep, "
    "maar die betaalde sinds "
    "januari 2025 geen rente meer. Het is nog niet beslist of de parken ook voor het hoogste bod "
    "worden verkocht. Van Rooi moet de komende week nog beslissen aan welke bieders hij de parken "
    "verkoopt."
)
# The same news in an outlet's own words
OWN = (
    "Voor de campings van Peter Gillis is op de veiling in totaal zo'n 27 miljoen euro geboden. "
    "Zakenman Marc van Rooi, die de parken laat veilen omdat hij geld terug wil zien, kiest "
    "volgende week een koper. Gillis zelf zat niet in de zaal. Een woordvoerder van de "
    "veilingmeester wilde niet zeggen hoeveel bieders er waren en of er ook buitenlandse "
    "partijen meeboden. In Brabant reageren campinggasten verdeeld op de verkoop van de bekende "
    "parken van de realityster."
)
QUOTE = "„We hebben er alles aan gedaan om de parken te behouden, maar dit is het einde”"
T0 = datetime(2026, 10, 1, 13, 41, tzinfo=timezone.utc)


def article(
    article_id: int,
    outlet: str,
    text: str,
    *,
    minutes: int = 0,
    publisher: str | None = None,
    names_anp: bool = False,
    code: str | None = None,
) -> CopyArticle:
    return CopyArticle(
        id=article_id,
        outlet=outlet,
        published_at=T0 + timedelta(minutes=minutes),
        text=text_print(text),
        publisher=publisher,
        names_anp=names_anp,
        code=code,
    )


def test_quotes_and_page_furniture_do_not_count() -> None:
    printed = text_print(
        f"{QUOTE}, zei Gillis. Maak RTL je Google-favoriet Gillis zat niet in de zaal."
    )
    words = [gram.split()[0] for segment in printed.segments for gram in segment]
    assert "hebben" not in words  # inside the quote
    # "zei gillis" and "gillis zat niet in de zaal", apart: a passage never runs across furniture
    assert printed.words == 2 + 6
    assert printed.segments == [["gillis zat niet in de zaal"]]
    assert "maak" not in " ".join(printed.grams)


def test_a_copy_is_the_same_text_and_a_shortened_copy_is_fully_in_its_source() -> None:
    source = text_print(AGENCY)
    copy = text_print(AGENCY)
    shortened = text_print(AGENCY.split(" Het is nog niet beslist")[0])
    assert overlap(source, copy) == pytest.approx(1.0)
    assert coverage(shortened, source) == pytest.approx(1.0)
    assert coverage(source, shortened) < 0.8
    assert overlap(source, shortened) == pytest.approx(1.0)


def test_own_words_and_a_shared_quote_are_not_a_copy() -> None:
    own = text_print(f"{OWN} {QUOTE}, zei Gillis.")
    agency = text_print(f"{AGENCY} {QUOTE}, zei Gillis.")
    assert overlap(own, agency) == 0.0


def test_a_passage_must_stand_in_the_same_order_in_both_texts() -> None:
    # Every word sequence of the second text occurs in the first, but from three places: no passage
    first = text_print(
        "De actrice had een korte cameo opgenomen waarin ze zichzelf speelde maar die scène haalde "
        "de montage niet. Volgens de makers paste haar optreden niet goed in de opbouw van de "
        "film. De film is een vervolg op de hit uit 2006 waarin onder anderen Meryl Streep "
        "terugkeert. Ook Anne Hathaway en Emily Blunt spelen weer mee in het tweede deel van de "
        "film over de mode."
    )
    second = text_print(
        "Het zou onvoldoende passen in de opbouw van de film the devil wears prada 2 is een "
        "vervolg op de hit uit 2006 en komt later dit jaar uit. De actrice speelde zichzelf in een "
        "cameo die de eindmontage niet haalde volgens insiders die de opnames van dichtbij "
        "hebben gevolgd."
    )
    assert coverage(second, first) == 0.0


def test_a_passage_counts_from_min_run_words() -> None:
    shared = " ".join(f"woord{i}" for i in range(MIN_RUN_WORDS))
    filler_a = " ".join(f"alfa{i}" for i in range(60))
    filler_b = " ".join(f"beta{i}" for i in range(60))
    a = text_print(f"{filler_a} {shared}")
    b = text_print(f"{shared} {filler_b}")
    assert coverage(a, b) == pytest.approx(MIN_RUN_WORDS / (60 + MIN_RUN_WORDS))
    short = " ".join(f"woord{i}" for i in range(MIN_RUN_WORDS - 1))
    assert coverage(text_print(f"{filler_a} {short}"), text_print(f"{short} {filler_b}")) == 0.0


def test_copy_probability_follows_the_calibration() -> None:
    assert copy_probability(0.0) == 0.0
    assert copy_probability(0.20) == pytest.approx(0.19, abs=0.01)
    assert copy_probability(0.27) == pytest.approx(0.5)
    assert copy_probability(0.36) == pytest.approx(0.87, abs=0.01)
    assert copy_probability(0.45) == pytest.approx(0.98, abs=0.01)
    assert copy_probability(1.0) > 0.999


def test_agency_copy_at_outlets_of_different_owners() -> None:
    groups = find_copy_groups(
        [
            article(1, "RTL Nieuws", AGENCY, publisher="DPG Media"),
            article(
                2,
                "De Telegraaf",
                AGENCY + " Gillis zat zelf niet in de zaal.",
                minutes=12,
                publisher="Mediahuis",
            ),
            article(3, "NOS", OWN, minutes=30),
        ],
        min_probability=0.5,
    )
    assert len(groups) == 1
    group = groups[0]
    assert [m.article_id for m in group.members] == [1, 2]
    assert group.key == 1  # the first one published
    assert group.source == "persbureau"
    assert group.agency is None and group.likely_agency == "ANP"
    assert group.outlets == ["De Telegraaf", "RTL Nieuws"]
    assert group.probability > 0.99
    rtl, telegraaf = group.members
    assert rtl.share == pytest.approx(1.0) and rtl.match == 2
    assert 0.9 < telegraaf.share < 1.0


def test_a_text_that_names_anp_is_agency_copy() -> None:
    groups = find_copy_groups(
        [
            article(
                1,
                "AD",
                AGENCY + " Dat laat Van Rooi weten aan het ANP.",
                publisher="DPG Media",
                names_anp=True,
            ),
            article(2, "Het Parool", AGENCY, minutes=5, publisher="DPG Media"),
        ],
        min_probability=0.5,
    )
    assert groups[0].source == "persbureau"
    assert groups[0].agency == "ANP" and groups[0].likely_agency is None


def test_one_article_of_one_publisher_under_one_code() -> None:
    groups = find_copy_groups(
        [
            article(1, "AD", AGENCY, publisher="DPG Media", code="43d58b6"),
            article(2, "Het Parool", AGENCY, minutes=45, publisher="DPG Media", code="43d58b6"),
        ],
        min_probability=0.5,
    )
    assert (groups[0].source, groups[0].publisher) == ("uitgever", "DPG Media")


def test_titles_of_one_owner_without_one_code_could_be_agency_copy() -> None:
    groups = find_copy_groups(
        [
            article(1, "RTL Nieuws", AGENCY, publisher="DPG Media"),
            article(2, "de Volkskrant", AGENCY, minutes=3, publisher="DPG Media", code="bcd4a5c"),
        ],
        min_probability=0.5,
    )
    assert (groups[0].source, groups[0].publisher, groups[0].likely_agency) == (
        None,
        "DPG Media",
        None,
    )


def test_without_owners_only_a_named_agency_says_where_it_comes_from() -> None:
    groups = find_copy_groups(
        [article(1, "RTL Nieuws", AGENCY), article(2, "De Telegraaf", AGENCY, minutes=12)],
        min_probability=0.5,
        know_publishers=False,
    )
    assert groups[0].source is None


def test_versions_of_one_outlet_are_not_linked_and_short_texts_are_left_out() -> None:
    assert (
        find_copy_groups(
            [article(1, "RTL Nieuws", AGENCY), article(2, "RTL Nieuws", AGENCY, minutes=30)],
            min_probability=0.5,
        )
        == []
    )
    assert (
        find_copy_groups(
            [
                article(1, "RTL Nieuws", "Peter Gillis verkoopt zijn parken."),
                article(2, "AD", "Peter Gillis verkoopt zijn parken."),
            ],
            min_probability=0.5,
        )
        == []
    )


def test_a_liveblog_that_holds_the_agency_text_joins_with_a_small_share() -> None:
    liveblog = " ".join(
        f"Eerder vandaag in het liveblog bericht {i} over iets heel anders dan de parken."
        for i in range(40)
    )
    groups = find_copy_groups(
        [
            article(1, "RTL Nieuws", AGENCY, publisher="DPG Media"),
            article(2, "AD", f"{liveblog} {AGENCY}", publisher="Mediahuis"),
        ],
        min_probability=0.5,
    )
    members = {m.article_id: m for m in groups[0].members}
    assert members[1].share == pytest.approx(1.0)
    assert members[2].share < 0.25


def test_articles_linked_through_a_third_form_one_group() -> None:
    first_half, second_half = AGENCY[: len(AGENCY) // 2], AGENCY[len(AGENCY) // 2 :]
    groups = find_copy_groups(
        [
            article(1, "RTL Nieuws", first_half + " " + OWN, publisher="DPG Media"),
            article(2, "De Telegraaf", AGENCY, minutes=10, publisher="Mediahuis"),
            article(3, "NOS", OWN.split(".")[0] + ". " + second_half, minutes=20),
        ],
        min_probability=0.3,
    )
    assert len(groups) == 1 and len(groups[0].members) == 3


def test_payload_per_link() -> None:
    groups = find_copy_groups(
        [
            article(1, "RTL Nieuws", AGENCY, publisher="DPG Media"),
            article(2, "De Telegraaf", AGENCY, publisher="Mediahuis", minutes=12),
        ],
        min_probability=0.5,
    )
    payloads = payloads_for(groups)
    assert set(payloads) == {1, 2}
    assert payloads[2] == copy_payload(groups[0], groups[0].members[1])
    assert payloads[2] | {"probability": 1.0, "group_probability": 1.0} == {
        "v": 2,
        "group": 1,
        "share": 1.0,
        "match": 1,
        "probability": 1.0,
        "group_probability": 1.0,
        "source": "persbureau",
        "agency": None,
        "likely_agency": "ANP",
        "publisher": None,
    }


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("https://www.ad.nl/politiek/in-stilte-repareert-asielminister~a43d58b6/", "43d58b6"),
        ("https://www.parool.nl/nederland/in-stilte-repareert-asielminister~b43d58b6/", "43d58b6"),
        ("https://www.trouw.nl/buitenland/live-vs~bbc0cf3d/?referrer=x", "bc0cf3d"),
        ("https://www.rtl.nl/nieuws/artikel/5659082/atlete-hassan", None),
        (None, None),
    ],
)
def test_article_code_of_the_dpg_titles(url: str | None, code: str | None) -> None:
    assert article_code(url) == code


class _StubCopyService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def refresh_recent(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("recent", kwargs))
        return {"events": 3, "updated_links": 2}

    async def refresh_events(self, event_ids: list[int]) -> dict[str, int]:
        self.calls.append(("events", event_ids))
        found = 0 if event_ids == [404] else 1
        return {"events": found, "groups": found, "updated_links": 0}

    async def stored_groups(self, event_id: int) -> list[dict[str, Any]]:
        return [{"group": 1, "source": "persbureau", "articles": []}]


async def test_admin_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = _StubCopyService()
    monkeypatch.setattr(admin, "get_copy_detection_service", lambda: stub)

    assert (await admin.trigger_copy_detection(hours=24, dry_run=True))["updated_links"] == 2
    assert stub.calls[0] == (
        "recent",
        {"hours": 24, "force": False, "include_archived": False, "dry_run": True},
    )
    for hours in (0, 8761):
        with pytest.raises(HTTPException) as error:
            await admin.trigger_copy_detection(hours=hours)
        assert error.value.status_code == 400

    one = await admin.trigger_copy_detection_event(9449)
    assert one["event_id"] == 9449 and one["groups"][0]["source"] == "persbureau"
    with pytest.raises(HTTPException) as missing:
        await admin.trigger_copy_detection_event(404)
    assert missing.value.status_code == 404
