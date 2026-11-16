"""Citaat uit het persbericht (Story 14.34)."""

from datetime import datetime, timezone

from backend.app.services.copy_detection import text_print
from backend.app.services.press_releases import (
    ReleaseText,
    compare,
    flat_words,
    newest_lastmod,
    parse_release,
    quotes_in,
    sitemap_news,
)

RELEASE = (
    "Het kabinet geeft twintig collectiestukken terug aan Indonesië. Minister Paul zei daarover: "
    "„Deze objecten hebben een grote culturele en historische waarde voor Indonesië en daarom geven "
    "we ze terug.” De stukken komen uit het Rijksmuseum en het Wereldmuseum en gaan in november op "
    "transport. De commissie adviseerde de teruggave na onderzoek naar de herkomst van de objecten."
)


def _release(text=RELEASE):
    return ReleaseText(
        url="https://www.rijksoverheid.nl/actueel/nieuws/2026/10/09/collectiestukken",
        published_at=datetime(2026, 10, 9, 16, tzinfo=timezone.utc),
        print=text_print(text),
        flat=flat_words(text),
    )


def test_a_quote_that_stands_in_the_release():
    article = (
        "Nederland geeft roofkunst terug. „Deze objecten hebben een grote culturele en historische "
        "waarde voor Indonesië”, zegt de minister. Ook een „korte quote van zes woorden hier” telt niet."
    )
    assert quotes_in(article, _release().flat) == [
        "Deze objecten hebben een grote culturele en historische waarde voor Indonesië"
    ]


def test_a_quote_the_release_does_not_have():
    article = "„Wij hebben hier heel lang op gewacht en zijn de minister zeer dankbaar”, zegt de ambassadeur."
    assert quotes_in(article, _release().flat) == []


def test_running_text_from_the_release_is_a_share_of_the_article():
    own = "Een eigen inleiding van de krant over de teruggave van kunst aan Indonesië. " * 3
    article = (
        own
        + RELEASE.split("„")[0]
        + "De stukken komen uit het Rijksmuseum en het Wereldmuseum en gaan in november op transport."
    )
    quotes, share = compare(text_print(article), article, _release())
    assert quotes == []
    assert 0.3 < share < 0.8


def test_sitemap_news_and_lastmod():
    xml = """<urlset>
      <url><loc>https://www.rijksoverheid.nl/actueel/nieuws/2026/11/15/vogelgriep-oosterwolde</loc><lastmod>2026-11-15T20:06:27Z</lastmod></url>
      <url><loc>https://www.rijksoverheid.nl/documenten/kamerstukken/2026/11/15/brief</loc><lastmod>2026-11-15T10:00:00Z</lastmod></url>
    </urlset>"""
    [(url, day)] = sitemap_news(xml)
    assert url.endswith("vogelgriep-oosterwolde")
    assert day == datetime(2026, 11, 15, tzinfo=timezone.utc)
    assert newest_lastmod(xml) == "2026-11-15T20:06:27Z"


def test_parse_release_reads_title_organisation_and_time():
    body = " ".join(
        ["Het kabinet maakt vandaag bekend dat er meer geld komt voor de zorg in de regio."] * 6
    )
    page = f"""<html><head>
      <meta name="DCTERMS.title" content="Meer geld voor zorg | Rijksoverheid.nl">
      <meta name="DCTERMS.creator" content="Ministerie van Volksgezondheid, Welzijn en Sport">
      <meta name="DCTERMS.issued" content="2026-11-13T18:30:00.000Z">
      </head><body><main><article><h1>Meer geld voor zorg</h1><p>{body}</p><p>{body}</p></article></main></body></html>"""
    release = parse_release(
        "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/13/zorg",
        datetime(2026, 11, 13, tzinfo=timezone.utc),
        page,
    )
    assert release is not None
    assert release["title"] == "Meer geld voor zorg"
    assert release["organisation"] == "Ministerie van Volksgezondheid, Welzijn en Sport"
    assert release["published_at"] == datetime(2026, 11, 13, 18, 30, tzinfo=timezone.utc)
    assert "meer geld" in release["text"]


def test_a_page_without_text_is_no_release():
    assert (
        parse_release(
            "https://x", datetime(2026, 1, 1, tzinfo=timezone.utc), "<html><body>kort</body></html>"
        )
        is None
    )
