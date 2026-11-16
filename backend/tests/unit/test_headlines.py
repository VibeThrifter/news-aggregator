"""Koppen die veranderen (Story 14.32)."""

from datetime import datetime, timezone

from backend.app.ingestion.headlines import (
    TITLE_HISTORY_LIMIT,
    headline_change,
    is_live,
    normalize_headline,
    with_title_change,
)


def test_a_new_headline_above_the_same_article():
    # Trouw, 2026-11-15
    assert (
        headline_change(
            "Ook VVD zocht steun bij Denk rond belastingplan",
            "Coalitie praat maandag verder op Catshuis",
        )
        == "headline"
    )
    # RTL Nieuws: the same start, another ending
    assert (
        headline_change(
            "Laura Brand reageert op veroordeling echtgenoot Russell: pijnlijk",
            "Laura Brand reageert op veroordeling echtgenoot Russell: 'We vertrouwen op God'",
        )
        == "headline"
    )


def test_small_fixes_are_minor():
    # Spelling of a name, a word added, a soft hyphen
    assert (
        headline_change(
            "Mirra Andrejeva wint WTA Finals zonder ook maar een set te verliezen",
            "Mirra Andreeva wint WTA Finals zonder ook maar een set te verliezen",
        )
        == "minor"
    )
    assert (
        headline_change(
            "Zelensky vermoedt dat Navo-lidmaatschap Oekraïne als ruilmiddel op tafel ligt",
            "Zelensky vermoedt dat Navo-lidmaatschap van Oekraïne als ruilmiddel op tafel ligt",
        )
        == "minor"
    )
    assert (
        headline_change("een hulpsint-distributiecentrum", "een hulpsintdistri­bu­tie­centrum")
        == "minor"
    )


def test_the_same_headline_is_no_change():
    assert headline_change("Kabinet &amp; Kamer", "Kabinet & Kamer") is None
    assert headline_change("‘Dit is het’", "'Dit is het'") is None
    assert headline_change("Iets", "") is None


def test_a_live_blog_keeps_its_first_headline():
    assert is_live("LIVE | Estland sluit grenzen")
    assert is_live("LIVE interlandvoetbal | Duitsland fit")
    assert not is_live("Oliver levert live verslag")
    assert (
        headline_change("LIVE | Estland sluit grenzen", "LIVE | Prins Harry in Oekraïne") == "live"
    )


def test_history_keeps_the_newest_entries():
    seen = datetime(2026, 11, 15, 22, 0, tzinfo=timezone.utc)
    meta = {"name": "Trouw"}
    for i in range(TITLE_HISTORY_LIMIT + 2):
        meta = with_title_change(meta, f"Kop {i}", seen)
    assert meta["name"] == "Trouw"
    assert len(meta["title_history"]) == TITLE_HISTORY_LIMIT
    assert meta["title_history"][-1] == {
        "title": f"Kop {TITLE_HISTORY_LIMIT + 1}",
        "until": seen.isoformat(),
    }


def test_normalize_headline():
    assert normalize_headline("  Een  “kop”​ ") == 'Een "kop"'
