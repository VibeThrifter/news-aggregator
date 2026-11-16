# ruff: noqa: S101
"""Achtergrondstukken (Story 14.29): documents in Bron about a news item."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
import pytest

from backend.app.llm.schemas import FactualPayload, InsightsPayload
from backend.app.services.background_documents import (
    MAX_DOCUMENTS,
    BackgroundDocumentsService,
    FoundDocument,
    clean_terms,
    clean_title,
    documents_from_hits,
    search_params,
    select_documents,
    terms_of,
)


def hit(
    title: str, url: str, published: str | None = "2025-05-15T10:00:00+00:00", **extra: Any
) -> dict:
    return {
        "_source": {
            "title": title,
            "url": url,
            "published": published,
            "source": extra.get("source", "openbesluitvorming"),
            "type": extra.get("type", "Bestand"),
            "location_name": extra.get("location", "Rotterdam"),
        }
    }


def doc(title: str, url: str, published: datetime | None) -> FoundDocument:
    return FoundDocument("Silja", "openbesluitvorming", None, title, url, published, "Rotterdam")


def test_clean_terms_keeps_two_distinct_usable_terms():
    assert clean_terms(["Silja", "silja", "MS Silja", "spreidingswet"]) == ["Silja", "MS Silja"]
    assert clean_terms("draagmoederschap") == ["draagmoederschap"]
    # Query syntax is removed, too short or too long terms go
    assert clean_terms(['title:"x" OR *', "ab", "a" * 61]) == ["title x OR"]
    assert clean_terms(None) == []
    assert clean_terms([3, None]) == []


def test_terms_of_reads_dict_and_json_text():
    assert terms_of({"zoektermen": ["Silja"]}) == ["Silja"]
    assert terms_of('{"zoektermen": ["Silja"], "model": "haiku"}') == ["Silja"]
    assert terms_of({"search_keywords": ["x"]}) == []
    assert terms_of("not json") == []
    assert terms_of(None) == []


def test_clean_title_drops_registration_number():
    assert clean_title("[24bb002195] Programma Werkbezoek Silja") == "Programma Werkbezoek Silja"
    assert clean_title("  Rib   Spreidingswet ") == "Rib Spreidingswet"
    assert clean_title("351.1 Opinie bewonersavond Floradorp") == "Opinie bewonersavond Floradorp"
    assert (
        clean_title("6. Brief Brahim Abid over het oudejaarvuur")
        == "Brief Brahim Abid over het oudejaarvuur"
    )
    # A year is part of the title
    assert clean_title("2025 Spreidingswet uitvoering") == "2025 Spreidingswet uitvoering"
    assert (
        clean_title("Behoud van het vreugdevuur in Floradorp.PDF")
        == "Behoud van het vreugdevuur in Floradorp"
    )
    assert clean_title("Dashboard VGR Oostbrug 2025.docx.pdf") == "Dashboard VGR Oostbrug 2025"


def test_only_documents_with_the_term_in_their_title():
    hits = [
        hit("[25bb003062] Debat over 'Erbarmelijke leefomstandigheden MS Silja'", "https://a.nl/1"),
        hit("Raadsvoorstel begroting 2026", "https://a.nl/2"),
        hit("Silja", "not-a-url"),
        {"_source": {"title": "", "url": "https://a.nl/3"}},
    ]
    found = documents_from_hits("silja", hits)
    assert [d.title for d in found] == ["Debat over 'Erbarmelijke leefomstandigheden MS Silja'"]
    assert found[0].published_at == datetime(2025, 5, 15, 10, tzinfo=timezone.utc)
    assert found[0].location == "Rotterdam"
    assert found[0].doc_type == "Bestand"


def test_select_documents_newest_first_each_title_once():
    docs = [
        doc(
            "Beantwoording vragen over de Silja",
            "https://a.nl/1",
            datetime(2024, 6, 26, tzinfo=timezone.utc),
        ),
        doc(
            "Beantwoording vragen over de Silja",
            "https://a.nl/2",
            datetime(2024, 7, 3, tzinfo=timezone.utc),
        ),
        doc("Programma Werkbezoek Silja", "https://a.nl/3", None),
        doc("Debat MS Silja", "https://a.nl/4", datetime(2025, 5, 15, tzinfo=timezone.utc)),
    ]
    chosen = select_documents(docs)
    assert [d.url for d in chosen] == ["https://a.nl/4", "https://a.nl/2", "https://a.nl/3"]
    many = [
        doc(f"Silja {i}", f"https://a.nl/{i}", datetime(2025, 1, i + 1, tzinfo=timezone.utc))
        for i in range(9)
    ]
    assert len(select_documents(many)) == MAX_DOCUMENTS
    assert select_documents(many)[0].title == "Silja 8"


def test_search_params_title_phrase_last_three_years():
    params = search_params("MS Silja", datetime(2026, 10, 21, tzinfo=timezone.utc))
    assert params["query"] == 'title:"MS Silja"'
    assert params["filter"] == "published_from:2023-10-22"
    assert params["sort"] == "_score:desc"


def test_factual_payload_zoektermen_never_fails_the_analysis():
    summary = "x" * 120
    assert FactualPayload(summary=summary).zoektermen == []
    assert FactualPayload(summary=summary, zoektermen="Silja").zoektermen == ["Silja"]
    assert FactualPayload(summary=summary, zoektermen=["a", " ", "b", "c"]).zoektermen == ["a", "b"]
    factual = FactualPayload(summary=summary, zoektermen=["spreidingswet"])
    from backend.app.llm.schemas import CriticalPayload

    assert InsightsPayload.from_phases(factual, CriticalPayload()).zoektermen == ["spreidingswet"]


@pytest.mark.asyncio
async def test_search_calls_bron_and_filters_on_title():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "hits": {
                    "hits": [
                        hit(
                            "Raadsinformatiebrief Spreidingswet",
                            "https://a.nl/1",
                            source="openbesluitvorming",
                        ),
                        hit("Begroting 2026", "https://a.nl/2"),
                    ]
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        found = await BackgroundDocumentsService(client=client)._search(client, "spreidingswet")
    assert [d.url for d in found] == ["https://a.nl/1"]
    assert seen[0].url.host == "api.bron.live"
    assert seen[0].url.params["query"] == 'title:"spreidingswet"'
