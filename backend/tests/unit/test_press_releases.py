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


# --- Story 14.40: a release in news it is about -------------------------------------------------

from types import SimpleNamespace  # noqa: E402

from backend.app.services.press_releases import (  # noqa: E402
    TOPIC_MAX_EVENTS,
    releases_about,
    topic_events,
    topic_text,
    topic_vectorizer,
)

AT = datetime(2026, 11, 16, 6, 30, tzinfo=timezone.utc)


def _article(event_id, hours):
    from datetime import timedelta

    return SimpleNamespace(event_id=event_id, published_at=AT + timedelta(hours=hours))


def test_topic_events_takes_the_best_article_per_news_item():
    articles = [_article(1, 0), _article(1, 2), _article(2, 5), _article(3, 1)]
    assert topic_events(AT, [0.31, 0.55, 0.29, 0.10], articles) == {1: 0.55}


def test_topic_events_window_from_a_day_before_to_three_days_after():
    articles = [_article(1, -23), _article(2, -25), _article(3, 71), _article(4, 73)]
    assert topic_events(AT, [0.5, 0.5, 0.5, 0.5], articles) == {1: 0.5, 3: 0.5}


def test_topic_events_keeps_a_news_item_it_had_with_a_little_less():
    articles = [_article(1, 0), _article(2, 0)]
    assert topic_events(AT, [0.27, 0.27], articles, kept=[2]) == {2: 0.27}
    assert topic_events(AT, [0.24, 0.24], articles, kept=[1, 2]) == {}


def test_topic_events_at_most_a_few_news_items():
    articles = [_article(n, 0) for n in range(6)]
    found = topic_events(AT, [0.40, 0.50, 0.60, 0.70, 0.35, 0.45], articles)
    assert list(found) == [3, 2, 1][:TOPIC_MAX_EVENTS]


def test_a_club_s_match_pages_go_into_no_news_by_topic():
    assert releases_about("cbs")
    assert releases_about("politie")
    assert not releases_about("ajax")
    assert releases_about("onbekend")


def test_topic_scores_find_the_same_news_and_not_other_news():
    filler = [
        f"Het weer wordt morgen {w} met kans op regen in het {d} van het land en wind uit het westen."
        for w, d in [
            ("zonnig", "noorden"),
            ("bewolkt", "zuiden"),
            ("koud", "oosten"),
            ("zacht", "westen"),
        ]
    ] * 3
    release = topic_text(
        "Detailhandel zet 3,1 procent meer om in derde kwartaal",
        "De omzet van de detailhandel was in het derde kwartaal 3,1 procent hoger dan een jaar eerder, "
        "meldt het CBS. Vooral webwinkels en supermarkten verkochten meer.",
    )
    same = topic_text(
        "Ruim 3 procent meer omzet voor detailhandel",
        "Winkels hebben in het derde kwartaal ruim 3 procent meer omgezet. Webwinkels en "
        "supermarkten deden het het best, zegt het CBS.",
    )
    other = topic_text(
        "Kabinet wil telefoons weren uit scholen",
        "Het kabinet wil dat leerlingen de hele schooldag geen telefoon gebruiken, schrijft de minister.",
    )
    vectorizer = topic_vectorizer().fit([release, same, other, *filler])
    r, a = vectorizer.transform([release]), vectorizer.transform([same, other])
    scores = (r @ a.T).toarray()[0]
    assert scores[0] > 0.3 > scores[1]
