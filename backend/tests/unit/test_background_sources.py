# ruff: noqa: S101
"""Achtergrondstukken buiten Bron (Story 14.31): Kamerstukken and the documents articles link to."""

from __future__ import annotations

from datetime import date, datetime, timezone

import httpx
import pytest

from backend.app.services.background_documents import combine_documents, links_of
from backend.app.services.background_sources import (
    OB_SOURCE,
    SOURCE_LINK,
    FoundDocument,
    linked_documents,
    ob_identifier,
    ob_kind,
    ob_records,
    ob_search_query,
    page_document,
    public_body,
    public_links,
    search_ob,
    tk_document_number,
)


def sru_record(
    identifier: str,
    title: str,
    *,
    documenttitel: str | None = None,
    publication: str = "Kamerstuk",
    subsection: str | None = "Motie",
    day: str = "2026-11-05",
) -> str:
    sub = (
        f"<overheidwetgeving:subrubriek>{subsection}</overheidwetgeving:subrubriek>"
        if subsection
        else ""
    )
    doc = (
        f"<overheidwetgeving:documenttitel>{documenttitel}</overheidwetgeving:documenttitel>"
        if documenttitel
        else ""
    )
    return f"""<sru:record><sru:recordData><gzd:gzd><gzd:originalData>
<overheidwetgeving:meta><overheidwetgeving:owmskern>
<dcterms:identifier>{identifier}</dcterms:identifier><dcterms:title>{title}</dcterms:title>
<dcterms:type>Kamerstuk</dcterms:type>
<dcterms:creator>Tweede Kamer der Staten-Generaal</dcterms:creator>
</overheidwetgeving:owmskern><overheidwetgeving:owmsmantel><dcterms:date>{day}</dcterms:date>
</overheidwetgeving:owmsmantel><overheidwetgeving:tpmeta>{doc}
<overheidwetgeving:publicatienaam>{publication}</overheidwetgeving:publicatienaam>{sub}
</overheidwetgeving:tpmeta></overheidwetgeving:meta></gzd:originalData>
<gzd:enrichedData><gzd:preferredUrl>https://zoek.officielebekendmakingen.nl/{identifier}.html</gzd:preferredUrl>
</gzd:enrichedData></gzd:gzd></sru:recordData></sru:record>"""


def sru(*records: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?><sru:searchRetrieveResponse '
        'xmlns:sru="http://docs.oasis-open.org/ns/search-ws/sruResponse" '
        'xmlns:gzd="http://standaarden.overheid.nl/sru" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:overheidwetgeving="http://standaarden.overheid.nl/wetgeving/">'
        f"<sru:numberOfRecords>{len(records)}</sru:numberOfRecords><sru:records>"
        f"{''.join(records)}</sru:records></sru:searchRetrieveResponse>"
    )


WARMTEPOMP = sru(
    sru_record(
        "kst-32813-1500",
        "Klimaatbeleid; Motie van het lid Kops over de voorgenomen warmtepompplicht schrappen",
        documenttitel="Motie van het lid Kops over de voorgenomen warmtepompplicht schrappen",
    ),
    sru_record(
        "ah-tk-20252026-300",
        "Uitstel beantwoording vragen van het lid Kops over de warmtepompplicht",
        publication="Kamervragen (Aanhangsel)",
        subsection="Mededeling",
    ),
    sru_record("blg-1300", "Beslisnota bij Kamerbrief over de warmtepompplicht", subsection=None),
    sru_record("kst-32813-1400", "Klimaatbeleid; Brief over isolatie", subsection="Brief"),
)


def test_ob_records_term_in_title_without_notices():
    found = ob_records(WARMTEPOMP, "warmtepompplicht")
    assert [d.key for d in found] == ["kst-32813-1500"]
    motion = found[0]
    assert motion.title == "Motie van het lid Kops over de voorgenomen warmtepompplicht schrappen"
    assert motion.doc_type == "Motie"
    assert motion.location == "Tweede Kamer"
    assert motion.source == OB_SOURCE
    assert motion.url == "https://zoek.officielebekendmakingen.nl/kst-32813-1500.html"
    assert motion.published_at == datetime(2026, 11, 5, tzinfo=timezone.utc)


def test_ob_records_without_term_keeps_every_record():
    # A document an article links to is about the news, whatever its title
    assert len(ob_records(WARMTEPOMP)) == 4


def test_ob_records_matches_words_not_punctuation():
    xml = sru(
        sru_record(
            "kst-19637-3555", "Vreemdelingenbeleid; Handhaving- en toezichtlocatie Hoogeveen"
        )
    )
    # clean_terms removes the hyphen from the analysis's term
    assert ob_records(xml, "Handhaving en Toezichtlocatie")


def test_ob_records_bad_xml_is_a_value_error():
    with pytest.raises(ValueError):
        ob_records("<html>error</html", "x")


def test_ob_kind_reads_as_a_reader_calls_it():
    assert ob_kind("Kamerstuk", "Motie") == "Motie"
    assert ob_kind("Kamerstuk", "Brief regering") == "Kamerbrief"
    assert ob_kind("Kamerstuk", None) == "Kamerstuk"
    assert ob_kind("Kamervragen (Aanhangsel)", "Antwoord") == "Antwoord op Kamervragen"
    assert ob_kind("Kamervragen zonder antwoord", "Schriftelijke vragen") == "Kamervragen"
    assert ob_kind("Handelingen", None) == "Kamerdebat"
    assert ob_kind("Staatsblad", None) == "Staatsblad"


def test_ob_search_query_titles_of_parliament_and_law_newest_first():
    query = ob_search_query("draagmoederschap", date(2023, 11, 15))
    assert 'dt.title="draagmoederschap"' in query
    assert "dt.date>=2023-11-15" in query
    assert 'w.publicatienaam=="Kamervragen (Aanhangsel)"' in query
    assert "Staatscourant" not in query
    assert query.endswith("sortBy dt.date/sort.descending")


def test_ob_identifier_from_links():
    assert (
        ob_identifier("https://zoek.officielebekendmakingen.nl/kst-32043-628.pdf")
        == "kst-32043-628"
    )
    assert ob_identifier("https://zoek.officielebekendmakingen.nl/ah-tk-20222023-3613.html") == (
        "ah-tk-20222023-3613"
    )
    assert (
        ob_identifier("https://zoek.officielebekendmakingen.nl/kv-tk-2026Z06769")
        == "kv-tk-2026z06769"
    )
    assert ob_identifier("https://zoek.officielebekendmakingen.nl/zoeken/resultaat") is None
    assert ob_identifier("https://example.com/kst-32043-628.pdf") is None


def test_tk_document_number_from_links():
    url = "https://www.tweedekamer.nl/kamerstukken/moties/detail?id=2026Z24981&did=2026D57700"
    assert tk_document_number(url) == "2026D57700"
    assert (
        tk_document_number("https://www.tweedekamer.nl/downloads/document?id=2026D12345")
        == "2026D12345"
    )
    assert tk_document_number("https://www.tweedekamer.nl/kamerleden_en_commissies") is None


def test_public_body_most_specific_host():
    assert public_body("https://energy.ec.europa.eu/news/x") == "Europese Commissie"
    assert (
        public_body("https://publications.europa.eu/resource/celex/32016R0300") == "Europese Unie"
    )
    assert public_body("https://www.rijksoverheid.nl/documenten/x") == "Rijksoverheid"
    assert public_body("https://wetten.overheid.nl/BWBR0005416") == "Wetten.nl"
    assert public_body("https://x.com/PvanHouwelingen/status/21") is None
    assert public_body("https://www.maurice.nl/2026/11/14/peiling/") is None


def test_public_links_most_outlets_first():
    brief = "https://www.rijksoverheid.nl/documenten/kamerstukken/2026/11/14/brief"
    cbs = "https://www.cbs.nl/nl-nl/nieuws/2026/46/cijfers"
    rows = [
        ("NieuwRechts", [cbs, brief, "https://x.com/a/status/1"]),
        ("NOS", [brief]),
        ("NOS", [brief]),
    ]
    assert public_links(rows) == [brief, cbs]


ROOT_PAGE = """<html><head>
<title>Kabinet stuurt brief over asielopvang | Rijksoverheid.nl</title>
<meta name="DCTERMS.title" content="Kabinet stuurt brief over asielopvang | Rijksoverheid.nl"/>
<meta name="DCTERMS.available" content="start=2026-11-14;"/>
<meta name="DCTERMS.modified" content="2026-11-15T09:00:00.000Z"/>
</head><body>...</body></html>"""


def test_page_document_title_and_publication_date():
    url = "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/14/kabinet-stuurt-brief"
    doc = page_document(ROOT_PAGE, url, url)
    assert doc is not None
    assert doc.title == "Kabinet stuurt brief over asielopvang"
    # available, never modified
    assert doc.published_at == datetime(2026, 11, 14, tzinfo=timezone.utc)
    assert doc.location == "Rijksoverheid"
    assert doc.source == SOURCE_LINK


def test_page_document_date_from_url_and_moved_pages():
    page = '<html><head><meta property="og:title" content="Commission launches dialogue"></head></html>'
    url = "https://energy.ec.europa.eu/news/commission-launches-dialogue-2026-10-28_en"
    doc = page_document(page, url, url)
    assert doc is not None and doc.published_at == datetime(2026, 10, 28, tzinfo=timezone.utc)
    # Sent to the home page: the document is gone
    assert (
        page_document(ROOT_PAGE, "https://www.rijksoverheid.nl/x", "https://www.rijksoverheid.nl/")
        is None
    )
    assert page_document("<html><head></head></html>", url, url) is None


def test_combine_documents_linked_first_each_once():
    linked = FoundDocument(
        "",
        OB_SOURCE,
        "Brief",
        "Brief",
        "https://zoek.officielebekendmakingen.nl/kst-1-2.pdf",
        None,
        "Tweede Kamer",
        key="kst-1-2",
    )
    searched_same = FoundDocument(
        "x",
        OB_SOURCE,
        "Brief",
        "Brief",
        "https://zoek.officielebekendmakingen.nl/kst-1-2.html",
        None,
        "Tweede Kamer",
        key="kst-1-2",
    )
    bron = FoundDocument(
        "x", "openbesluitvorming", None, "Raadsstuk", "https://a.nl/1", None, "Rotterdam"
    )
    assert combine_documents([linked], [searched_same], [bron]) == [linked, bron]


def test_links_of_reads_list_and_json_text():
    assert links_of(["https://a.nl", 3]) == ["https://a.nl"]
    assert links_of('["https://a.nl"]') == ["https://a.nl"]
    assert links_of(None) == []
    assert links_of("not json") == []


@pytest.mark.asyncio
async def test_search_ob_calls_the_sru():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=WARMTEPOMP)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        found = await search_ob(
            client, "warmtepompplicht", datetime(2026, 11, 15, tzinfo=timezone.utc)
        )
    assert [d.key for d in found] == ["kst-32813-1500"]
    assert seen[0].url.host == "repository.overheid.nl"
    assert "dt.date>=2023-11-15" in seen[0].url.params["query"]


@pytest.mark.asyncio
async def test_linked_documents_looks_up_each_kind():
    ob_link = "https://zoek.officielebekendmakingen.nl/kst-32813-1500.pdf"
    tk_link = "https://www.tweedekamer.nl/kamerstukken/moties/detail?id=2026Z1&did=2026D57700"
    page_link = "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/14/kabinet-stuurt-brief"
    dead_link = "https://www.cbs.nl/nl-nl/nieuws/2026/46/weg"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "repository.overheid.nl":
            assert "dt.identifier==kst-32813-1500" in request.url.params["query"]
            return httpx.Response(200, text=WARMTEPOMP)
        if request.url.host == "gegevensmagazijn.tweedekamer.nl":
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "DocumentNummer": "2026D57700",
                            "Soort": "Motie",
                            "Onderwerp": "Motie van de leden Struijs en Bikker over schenkingen",
                            "Datum": "2026-11-12T00:00:00+01:00",
                        }
                    ]
                },
            )
        if request.url.host == "www.rijksoverheid.nl":
            return httpx.Response(200, text=ROOT_PAGE, headers={"content-type": "text/html"})
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        found = await linked_documents(client, [ob_link, tk_link, page_link, dead_link, ob_link])

    assert [d.url for d in found] == [ob_link, tk_link, page_link]
    assert found[0].key == "kst-32813-1500" and found[0].doc_type == "Motie"
    assert found[1].title == "Motie van de leden Struijs en Bikker over schenkingen"
    assert found[1].location == "Tweede Kamer"
    assert found[1].published_at == datetime(2026, 11, 11, 23, tzinfo=timezone.utc)
    assert found[2].title == "Kabinet stuurt brief over asielopvang"
