# ruff: noqa: S101
"""Wikidata as a second opinion on persons without a role cue (Epic 12, 2026-10-16)."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx
import pytest

from backend.app.services.entity_research.wikidata import (
    WikidataClient,
    WikidataEntry,
    WikidataUnavailableError,
    occupation_kind,
    verdict,
)


@pytest.mark.parametrize(
    ("label", "kind"),
    [
        ("association football player", "Sporter"),
        ("association football coach", "Sporter"),
        ("sport cyclist", "Sporter"),
        ("Formula One driver", "Sporter"),
        ("singer-songwriter", "Artiest"),
        ("television actor", "Artiest"),
        ("painter", "Kunstenaar"),
        ("visual artist", "Kunstenaar"),
        # a place in the network, whatever else it says
        ("sports journalist", None),
        ("television presenter", None),
        ("music director", None),
        ("football executive", None),
        ("writer", None),
        ("university teacher", None),
        ("politician", None),
        ("", None),
    ],
)
def test_occupation_kind(label: str, kind: str | None) -> None:
    assert occupation_kind(label) == kind


def person(qid: str = "Q1", *occupations: str, **kw: Any) -> WikidataEntry:
    return WikidataEntry(qid=qid, human=True, occupations=occupations, **kw)


def test_athlete_or_artist_without_office_is_not_in_the_network() -> None:
    result = verdict([person("Q1", "association football player", "association football coach")])
    assert result.reason == "Sporter zonder rol in het netwerk (Wikidata)"
    assert result.qid == "Q1" and result.occupations[0] == "association football player"
    singer = verdict([person("Q2", "singer", "television actor")])
    assert singer.reason == "Artiest zonder rol in het netwerk (Wikidata)"


@pytest.mark.parametrize(
    "entries",
    [
        # also something else: a teacher and theorist (Kandinsky), a presenter, a politician
        [person("Q1", "painter", "university teacher", "art theorist")],
        [person("Q1", "singer", "television presenter")],
        [person("Q1", "association football player", offices=True)],
        [person("Q1", "singer", party=True)],
        # no occupation known
        [person("Q1")],
        # two people with this name
        [person("Q1", "singer"), person("Q2", "politician")],
        # not a person
        [WikidataEntry(qid="Q3", description="schilderij")],
        [],
    ],
)
def test_no_verdict(entries: list[WikidataEntry]) -> None:
    assert verdict(entries).reason is None


def test_fictional_character_only_without_a_person_of_that_name() -> None:
    character = WikidataEntry(qid="Q9", description="personage", fictional=True)
    result = verdict([character])
    assert result.reason == "Verzonnen personage (Wikidata)" and result.qid == "Q9"
    assert verdict([character, person("Q1", "politician")]).reason is None


def test_verdict_as_json() -> None:
    at = datetime(2026, 10, 16, tzinfo=timezone.utc)
    data = verdict([person("Q1", "speed skater", description="Nederlands schaatser")]).as_json(at)
    assert data == {
        "qid": "Q1",
        "reason": "Sporter zonder rol in het netwerk (Wikidata)",
        "description": "Nederlands schaatser",
        "occupations": ["speed skater"],
        "checked_at": "2026-10-16T00:00:00+00:00",
    }


# ------------------------------------------------------------------ client
def claims(prop_values: dict[str, list[str]]) -> dict[str, Any]:
    return {
        prop: [{"mainsnak": {"datavalue": {"value": {"id": value}}}} for value in values]
        for prop, values in prop_values.items()
    }


ENTITIES = {
    "Q100": {
        "descriptions": {"nl": {"value": "Nederlands voetballer"}},
        "claims": claims({"P31": ["Q5"], "P106": ["Q937857"]}),
    },
    "Q200": {
        "descriptions": {"nl": {"value": "personage uit een boek"}},
        "claims": claims({"P31": ["Q95074"]}),
    },
}
LABELS = {"Q5": "human", "Q937857": "association football player", "Q95074": "fictional character"}


def wikidata_api(requests: list[dict[str, str]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        requests.append(params)
        assert request.headers["User-Agent"].startswith("NieuwsAggregator")
        if params["action"] == "wbsearchentities":
            hits = {
                "Virgil van Dijk": [
                    {"id": "Q100", "label": "Virgil van Dijk"},
                    {"id": "Q101", "label": "Virgil van Dijk-Stadion"},  # not the same name
                ],
                "Winnie de Poeh": [
                    {
                        "id": "Q200",
                        "label": "Winnie the Pooh",
                        "match": {"type": "alias", "text": "Winnie de Poeh"},
                    }
                ],
            }.get(params["search"], [])
            return httpx.Response(200, json={"search": hits})
        ids = params["ids"].split("|")
        if params["props"] == "labels":
            return httpx.Response(
                200,
                json={"entities": {q: {"labels": {"en": {"value": LABELS[q]}}} for q in ids}},
            )
        return httpx.Response(200, json={"entities": {q: ENTITIES[q] for q in ids}})

    return httpx.MockTransport(handler)


async def test_lookup_exact_name_with_occupation_labels() -> None:
    requests: list[dict[str, str]] = []
    client = WikidataClient(min_interval=0, transport=wikidata_api(requests))
    [entry] = await client.lookup("Virgil van Dijk")
    assert entry.qid == "Q100" and entry.human and not entry.fictional
    assert entry.occupations == ("association football player",)
    assert entry.description == "Nederlands voetballer"
    assert verdict([entry]).reason == "Sporter zonder rol in het netwerk (Wikidata)"
    assert [r["action"] for r in requests] == [
        "wbsearchentities",
        "wbgetentities",
        "wbgetentities",
    ]
    # labels are kept: a second lookup needs no label request
    requests.clear()
    await client.lookup("Virgil van Dijk")
    assert len(requests) == 2


async def test_lookup_alias_and_fictional_character() -> None:
    client = WikidataClient(min_interval=0, transport=wikidata_api([]))
    [entry] = await client.lookup("Winnie de Poeh")
    assert entry.fictional and not entry.human
    assert await client.lookup("Niemand Bekend") == []


async def test_lookup_errors_are_unavailable() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="too many requests")

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no network", request=request)

    def api_error(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": {"code": "maxlag"}})

    for handler in (refuse, broken, api_error):
        client = WikidataClient(min_interval=0, transport=httpx.MockTransport(handler))
        with pytest.raises(WikidataUnavailableError):
            await client.lookup("Virgil van Dijk")


async def test_requests_are_paced() -> None:
    """Wikimedia wants serial requests: a burst got 429 (2026-10-19)."""

    moments: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        moments.append(time.monotonic())
        return httpx.Response(200, json={"search": []})

    client = WikidataClient(min_interval=0.05, transport=httpx.MockTransport(handler))
    await client.lookup("Een Naam")
    await client.lookup("Andere Naam")
    assert len(moments) == 2 and moments[1] - moments[0] >= 0.045


def test_user_agent_and_pace_follow_the_contact() -> None:
    """Wikimedia: 10 requests a minute without contact details, 200 with (2026-10-19)."""

    anonymous = WikidataClient()
    assert anonymous.user_agent == "NieuwsAggregator/1.0 (Wie is dit? role triage)"
    assert anonymous.min_interval >= 6.0
    known = WikidataClient(contact="https://example.org/nieuws")
    assert known.user_agent == (
        "NieuwsAggregator/1.0 (Wie is dit? role triage; https://example.org/nieuws)"
    )
    assert known.min_interval < 1.0
