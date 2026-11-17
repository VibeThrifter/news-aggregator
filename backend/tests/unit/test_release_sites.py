"""Persberichten van meer afzenders (Story 14.39): senders, sitemaps, Politie API, boilerplate."""

from datetime import datetime, timedelta, timezone

from backend.app.services.copy_detection import text_print
from backend.app.services.press_releases import (
    ReleaseText,
    boilerplate_grams,
    compare,
    flat_words,
    strip_boilerplate,
)
from backend.app.services.release_sites import (
    SITE_BY_KEY,
    SITES,
    clean_title,
    parse_politie_page,
    parse_release,
    parse_when,
    politie_days,
    politie_release,
    politie_url,
    quiet_sites,
    sitemap_candidates,
    sitemap_news,
    url_day,
)

UTC = timezone.utc


def test_every_sender_has_a_unique_key_that_fits_the_table():
    keys = [site.key for site in SITES]
    assert len(keys) == len(set(keys))
    assert all(len(key) <= 40 for key in keys)
    assert all(site.sitemaps and site.news for site in SITES if site.kind == "sitemap")


def test_times_from_iso_dates_and_addresses():
    assert parse_when("2026-10-01") == datetime(2026, 10, 1, tzinfo=UTC)
    assert parse_when("2026-10-01T14:29:03+02:00") == datetime(2026, 10, 1, 12, 29, 3, tzinfo=UTC)
    assert parse_when("2026-11-16T15:20:08.8000000Z") == datetime(
        2026, 11, 16, 15, 20, 8, 800000, tzinfo=UTC
    )
    assert parse_when("") is None and parse_when("gisteren") is None
    assert url_day("https://www.om.nl/actueel/nieuws/2026/10/30/arrestaties") == datetime(
        2026, 10, 30, tzinfo=UTC
    )
    assert url_day("https://www.defensie.nl/nieuws/20261002-navo") == datetime(
        2026, 10, 2, tzinfo=UTC
    )
    assert url_day("https://www.prorail.nl/nieuws/werk") is None


def test_the_platform_sitemap_of_another_site():
    xml = """<urlset>
      <url><loc>https://www.om.nl/actueel/nieuws/2026/11/16/celstraf-overval</loc><lastmod>2026-11-16T14:42:38Z</lastmod></url>
      <url><loc>https://www.om.nl/onderwerpen/fraude</loc><lastmod>2026-11-16T10:00:00Z</lastmod></url>
      <url><loc>https://www.rijksoverheid.nl/actueel/nieuws/2026/11/16/elders</loc></url>
    </urlset>"""
    assert sitemap_news(xml, "https://www.om.nl") == [
        (
            "https://www.om.nl/actueel/nieuws/2026/11/16/celstraf-overval",
            datetime(2026, 11, 16, tzinfo=UTC),
        )
    ]


def test_sitemap_candidates_take_news_changed_in_the_window():
    site = SITE_BY_KEY["prorail"]
    xml = """<urlset>
      <url><loc>https://www.prorail.nl/nieuws/werk-utrecht</loc><lastmod>2026-11-15T10:00:00+00:00</lastmod></url>
      <url><loc>https://www.prorail.nl/nieuws/oud-bericht</loc><lastmod>2025-01-01T10:00:00+00:00</lastmod></url>
      <url><loc>https://www.prorail.nl/en/news/english</loc><lastmod>2026-11-15T10:00:00+00:00</lastmod></url>
      <url><loc>https://www.prorail.nl/nieuws/werk-utrecht/fotos</loc><lastmod>2026-11-15T10:00:00+00:00</lastmod></url>
    </urlset>"""
    found = sitemap_candidates(xml, site, datetime(2026, 11, 12, tzinfo=UTC))
    assert found == [
        ("https://www.prorail.nl/nieuws/werk-utrecht", datetime(2026, 11, 15, 10, tzinfo=UTC))
    ]


def test_a_news_sitemap_gives_its_publication_date_and_undated_entries_count_when_small():
    site = SITE_BY_KEY["rechtspraak"]
    xml = """<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url><loc>https://www.rechtspraak.nl/organisatie/rechtbank-gelderland/nieuws/2026/11/celstraf</loc>
        <news:news><news:publication_date>2026-11-16T10:38:31+01:00</news:publication_date></news:news></url>
      <url><loc>https://www.rechtspraak.nl/organisatie/rechtbank-gelderland/nieuws/2026/11/zonder-datum</loc></url>
    </urlset>"""
    found = dict(sitemap_candidates(xml, site, datetime(2026, 11, 14, tzinfo=UTC)))
    assert found[
        "https://www.rechtspraak.nl/organisatie/rechtbank-gelderland/nieuws/2026/11/celstraf"
    ] == datetime(2026, 11, 16, 9, 38, 31, tzinfo=UTC)
    assert (
        found[
            "https://www.rechtspraak.nl/organisatie/rechtbank-gelderland/nieuws/2026/11/zonder-datum"
        ]
        is None
    )


def _page(meta: str, words: int = 40) -> str:
    body = " ".join(
        ["De rechtbank veroordeelde de man vandaag tot een celstraf van drie jaar."] * (words // 10)
    )
    article = f"<main><article><h1>Kop</h1><p>{body}</p><p>{body}</p></article></main>"
    return f"<html><head>{meta}</head><body>{article}</body></html>"


def test_a_page_keeps_the_senders_own_name_and_its_published_time():
    page = _page(
        '<meta name="DCTERMS.title" content="Celstraf voor overval">'
        '<meta name="DCTERMS.creator" content="Ministerie van Justitie en Veiligheid">'
        '<meta name="DCTERMS.issued" content="2026-10-30T17:32:00.000Z">'
    )
    release = parse_release(
        "https://www.om.nl/actueel/nieuws/2026/10/30/celstraf",
        None,
        page,
        organisation="Openbaar Ministerie",
        use_creator=False,
    )
    assert release["organisation"] == "Openbaar Ministerie"
    assert release["title"] == "Celstraf voor overval"
    assert release["published_at"] == datetime(2026, 10, 30, 17, 32, tzinfo=UTC)


def test_a_page_without_its_own_time_takes_structured_data_or_the_address():
    page = _page(
        '<meta property="og:title" content="Werk aan het spoor">'
        '<script type="application/ld+json">{"datePublished": "2026-10-01"}</script>'
    )
    release = parse_release(
        "https://www.prorail.nl/nieuws/werk", None, page, organisation="ProRail", use_creator=False
    )
    assert release["published_at"] == datetime(2026, 10, 1, tzinfo=UTC)
    assert release["title"] == "Werk aan het spoor"


POLITIE_ITEM = {
    "titel": "Aanhouding na overval",
    "url": "https://www.politie.nl/nieuws/2026/november/16/aanhouding.html",
    "publicatiedatum": "2026-11-16 21:09:00",
    "introductie": "&lt;p&gt;De politie heeft een man aangehouden.&lt;/p&gt;",
    "alineas": [
        {
            "opgemaaktetekst": "&lt;p&gt;"
            + "De man werd aangehouden na een overval op een tankstation in Arnhem. " * 3
            + "&lt;/p&gt;"
        }
    ],
}


def test_a_politie_item_becomes_a_release_in_utc():
    release = politie_release(POLITIE_ITEM)
    assert release["organisation"] == "Politie"
    assert release["published_at"] == datetime(2026, 11, 16, 20, 9, tzinfo=UTC)
    assert release["text"].startswith("De politie heeft een man aangehouden. De man werd")
    assert "&lt;" not in release["text"]
    assert politie_release({**POLITIE_ITEM, "alineas": [], "introductie": "Kort."}) is None


def test_politie_pages_and_days():
    releases, last = parse_politie_page(
        {"iterator": {"last": True}, "nieuwsberichten": [POLITIE_ITEM]}
    )
    assert len(releases) == 1 and last
    assert parse_politie_page({"iterator": {"last": False}, "nieuwsberichten": []})[1] is True
    days = politie_days(datetime(2026, 11, 16, 23, 30, tzinfo=UTC), 2)
    assert [day.day for day in days] == [17, 16, 15]  # 23:30 UTC is already the 17th in Dutch time
    assert "fromdate=20261117&todate=20261117" in politie_url(days[0], 25)


def test_quiet_senders_are_reported():
    now = datetime(2026, 11, 16, 12, tzinfo=UTC)
    sites = (SITE_BY_KEY["politie"], SITE_BY_KEY["om"], SITE_BY_KEY["nctv"])
    newest = {"politie": now - timedelta(days=2), "om": now - timedelta(hours=5)}
    assert quiet_sites(newest, now, sites) == ["politie", "nctv"]


TIP_LINE = (
    "Heeft u informatie over deze zaak? Neem dan contact op met de politie via 0900-8844 of "
    "anoniem met Meld Misdaad Anoniem via 0800-7000."
)


def test_a_senders_boilerplate_is_no_match_but_its_news_is():
    others = [
        f"Bericht {i} over een inbraak in wijk {i} met een eigen verhaal erbij. {TIP_LINE}"
        for i in range(8)
    ]
    boiler = boilerplate_grams(others)
    assert boiler and boilerplate_grams(others[:3]) == set()
    news = (
        "De politie heeft zondagavond in Arnhem twee mannen aangehouden na een overval op een "
        "tankstation aan de Velperweg."
    )
    release_text = f"{news} {TIP_LINE}"
    release = ReleaseText(
        url="https://www.politie.nl/x",
        published_at=datetime(2026, 11, 16, tzinfo=UTC),
        print=strip_boilerplate(text_print(release_text), boiler),
        flat=flat_words(release_text),
    )
    own = (
        "Een eigen inleiding van de krant over wat er in de stad gebeurde, met eigen woorden. " * 2
    )
    only_tip = own + TIP_LINE
    assert compare(text_print(only_tip), only_tip, release)[1] == 0
    with_news = own + news
    assert compare(text_print(with_news), with_news, release)[1] > 0


def test_titles_lose_the_site_after_them_only():
    assert clean_title("Meer geld voor zorg | Rijksoverheid.nl") == "Meer geld voor zorg"
    assert (
        clean_title("Drie arrestaties | Openbaar Ministerie", ("Openbaar Ministerie",))
        == "Drie arrestaties"
    )
    assert (
        clean_title("Highlights Ajax - AZ | Belangrijke driepunter", ("Ajax",))
        == "Highlights Ajax - AZ | Belangrijke driepunter"
    )
