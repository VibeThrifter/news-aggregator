"""Kamervragen over het nieuws en stemmingen (Story 14.33)."""

from backend.app.services.parliament_citations import (
    askers_of,
    dpg_code,
    merge_cites,
    page_links,
    question_records,
    url_key,
    vote_filter,
    vote_of,
    vote_target,
)

SRU = """<?xml version="1.0" encoding="UTF-8"?>
<sru:searchRetrieveResponse xmlns:sru="http://docs.oasis-open.org/ns/search-ws/sruResponse"
  xmlns:gzd="http://standaarden.overheid.nl/sru" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:overheidwetgeving="http://standaarden.overheid.nl/wetgeving/">
<sru:records>
 <sru:record><sru:recordData><gzd:gzd><gzd:originalData><overheidwetgeving:meta>
  <dcterms:identifier>kv-1279790</dcterms:identifier>
  <dcterms:title>Het bericht 'Bedrijven hebben minder stagevacatures'</dcterms:title>
  <dcterms:date>2026-11-13</dcterms:date>
  <overheidwetgeving:publicatienaam>Kamervragen zonder antwoord</overheidwetgeving:publicatienaam>
 </overheidwetgeving:meta></gzd:originalData><gzd:enrichedData>
  <gzd:preferredUrl>https://zoek.officielebekendmakingen.nl/kv-1279790.html</gzd:preferredUrl>
  <gzd:itemUrl manifestation="pdf">https://repository.overheid.nl/kv-1279790.pdf</gzd:itemUrl>
 </gzd:enrichedData></gzd:gzd></sru:recordData></sru:record>
 <sru:record><sru:recordData><gzd:gzd><gzd:originalData><overheidwetgeving:meta>
  <dcterms:identifier>kv-tk-2026Z22400</dcterms:identifier>
  <dcterms:title>Het bericht ‘UWV stopt met ICT-project dat 55 miljoen euro kostte’.</dcterms:title>
  <dcterms:date>2026-10-15</dcterms:date>
  <overheidwetgeving:publicatienaam>Kamervragen zonder antwoord</overheidwetgeving:publicatienaam>
 </overheidwetgeving:meta></gzd:originalData><gzd:enrichedData>
  <gzd:preferredUrl>https://zoek.officielebekendmakingen.nl/kv-tk-2026Z22400.html</gzd:preferredUrl>
  <gzd:itemUrl manifestation="html">https://repository.overheid.nl/kv-tk-2026Z22400.html</gzd:itemUrl>
  <gzd:itemUrl manifestation="xml">https://repository.overheid.nl/kv-tk-2026Z22400.xml</gzd:itemUrl>
 </gzd:enrichedData></gzd:gzd></sru:recordData></sru:record>
 <sru:record><sru:recordData><gzd:gzd><gzd:originalData><overheidwetgeving:meta>
  <dcterms:identifier>ah-tk-20252026-1948</dcterms:identifier>
  <dcterms:title>Antwoord op vragen van het lid Westerveld</dcterms:title>
  <dcterms:date>2026-10-20</dcterms:date>
  <overheidwetgeving:publicatienaam>Kamervragen (Aanhangsel)</overheidwetgeving:publicatienaam>
  <overheidwetgeving:subrubriek>Antwoord</overheidwetgeving:subrubriek>
 </overheidwetgeving:meta></gzd:originalData><gzd:enrichedData>
  <gzd:itemUrl manifestation="xml">https://repository.overheid.nl/ah-tk-20252026-1948.xml</gzd:itemUrl>
 </gzd:enrichedData></gzd:gzd></sru:recordData></sru:record>
</sru:records></sru:searchRetrieveResponse>"""

PAGE = """<html><body>
<p>Vragen van het lid Ergin (DENK) aan de Minister van Sociale Zaken en Werkgelegenheid over het
bericht «UWV stopt met ICT-project» (ingezonden 15 oktober 2026).</p>
<p>Vraag 1 Bent u bekend met dit bericht?<sup>1</sup></p>
<p class="voetnoot">1 NU.nl, 14 oktober 2026, https://www.nu.nl/tech/6413139/uwv-stopt.html?utm_source=x.</p>
<a href="https://www.officielebekendmakingen.nl/">Home</a>
<a href="https://repository.officiele-overheidspublicaties.nl/x">bestand</a>
<a href="https://www.nu.nl/tech/6413139/uwv-stopt.html?utm_source=x">link</a>
</body></html>"""


def test_only_formatted_sets_are_read():
    records = question_records(SRU)
    assert [r.identifier for r in records] == ["kv-tk-2026z22400", "ah-tk-20252026-1948"]
    uwv, answer = records
    assert uwv.read_url.endswith(".html")
    assert uwv.url == "https://zoek.officielebekendmakingen.nl/kv-tk-2026Z22400.html"
    assert uwv.doc_type == "Kamervragen"
    assert uwv.published_at.date().isoformat() == "2026-10-15"
    assert answer.doc_type == "Antwoord op Kamervragen"
    assert answer.read_url.endswith(".xml")
    assert answer.url == "https://zoek.officielebekendmakingen.nl/ah-tk-20252026-1948.html"


def test_links_of_a_set_without_the_publication_furniture():
    assert page_links(PAGE) == ["https://www.nu.nl/tech/6413139/uwv-stopt.html?utm_source=x"]


def test_who_asked():
    assert askers_of(PAGE) == "Ergin (DENK)"
    assert (
        askers_of(
            "<p>Vragen van de leden Dobbe (SP) en Van Baarle (DENK) aan de Minister van BZ</p>"
        )
        == "Dobbe (SP) en Van Baarle (DENK)"
    )
    assert (
        askers_of("<p>Mondelinge vragen van het lid Van Brenk (50PLUS) aan de Staatssecretaris</p>")
        == "Van Brenk (50PLUS)"
    )
    assert (
        askers_of("<p>Vragen namens het lid Keijzer (Keijzer) aan de Minister van VRO</p>")
        == "Keijzer (Keijzer)"
    )
    assert askers_of("<p>Geen vragensteller</p>") is None


def test_url_key_compares_links_to_one_article():
    a = url_key("https://www.nu.nl/tech/6413139/uwv-stopt.html?utm_source=x#top")
    assert a == "nu.nl/tech/6413139/uwv-stopt.html"
    assert url_key("http://nu.nl/tech/6413139/uwv-stopt.html/") == a
    assert url_key("https://m.nos.nl/artikel/1") == "nos.nl/artikel/1"
    assert url_key("geen url") == ""


def test_dpg_code_survives_a_new_slug():
    assert dpg_code("https://www.ad.nl/binnenland/oude-kop~a43d58b6/?referrer=x") == "~a43d58b6"
    assert dpg_code("https://www.nu.nl/tech/6413139/uwv.html") is None


def test_vote_target_of_a_kamerstuk():
    assert vote_target("https://zoek.officielebekendmakingen.nl/kst-36180-237.html") == (
        36180,
        None,
        237,
    )
    assert vote_target("https://zoek.officielebekendmakingen.nl/kst-36800-IV-12.html") == (
        36800,
        "IV",
        12,
    )
    assert vote_target("https://openbesluitvorming.nl/?x=1") is None
    assert "k/Toevoeging eq null" in vote_filter(36180, None, 237)
    assert "k/Toevoeging eq 'IV'" in vote_filter(36800, "IV", 12)
    assert "Volgnummer eq 237" in vote_filter(36180, None, 237)


def test_vote_by_show_of_hands():
    payload = {
        "value": [
            {
                "Besluit": [
                    {"BesluitTekst": "Ingediend", "Stemming": [], "GewijzigdOp": "2026-10-01"},
                    {
                        "BesluitTekst": "Aangenomen.",
                        "StemmingsSoort": "Met handopsteken",
                        "GewijzigdOp": "2026-10-07",
                        "Stemming": [
                            {"Soort": "Voor", "ActorFractie": "D66", "FractieGrootte": 26},
                            {"Soort": "Voor", "ActorFractie": "VVD", "FractieGrootte": 22},
                            {"Soort": "Tegen", "ActorFractie": "PVV", "FractieGrootte": 19},
                            {
                                "Soort": "Niet deelgenomen",
                                "ActorFractie": "BBB",
                                "FractieGrootte": 4,
                            },
                        ],
                    },
                ]
            }
        ]
    }
    vote = vote_of(payload)
    assert vote == {
        "result": "Aangenomen",
        "kind": "Met handopsteken",
        "for": [["D66", 26], ["VVD", 22]],
        "against": [["PVV", 19]],
        "seats_for": 48,
        "seats_against": 19,
    }


def test_roll_call_counts_members():
    payload = {
        "value": [
            {
                "Besluit": [
                    {
                        "BesluitTekst": "Verworpen.",
                        "StemmingsSoort": "Hoofdelijk",
                        "Stemming": [
                            {"Soort": "Voor", "ActorFractie": "SP", "ActorNaam": "Dobbe"},
                            {"Soort": "Tegen", "ActorFractie": "VVD", "ActorNaam": "A"},
                            {"Soort": "Tegen", "ActorFractie": "VVD", "ActorNaam": "B"},
                        ],
                    }
                ]
            }
        ]
    }
    vote = vote_of(payload)
    assert vote["result"] == "Verworpen"
    assert vote["against"] == [["VVD", 2]]
    assert vote["seats_for"] == 1


def test_not_voted_yet():
    assert (
        vote_of({"value": [{"Besluit": [{"BesluitTekst": "Ingediend", "Stemming": []}]}]}) is None
    )
    assert vote_of({}) is None


def test_merge_cites_keeps_each_article_once():
    merged = merge_cites(
        [{"article_id": 1, "outlet": "NOS"}],
        [{"article_id": 1, "outlet": "NOS"}, {"article_id": 2, "outlet": "AD"}],
    )
    assert [c["article_id"] for c in merged] == [1, 2]
