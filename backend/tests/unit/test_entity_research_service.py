# ruff: noqa: S101
"""Entity research orchestration: triage, queue, status and rounds (Epic 12, Story 12.7)."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from backend.app.db.models import (
    Article,
    EntityResearch,
    Event,
    EventArticle,
    EventEntity,
    LLMInsight,
)
from backend.app.services.entity_research import priority as prio
from backend.app.services.entity_research.pm_client import (
    PmApiError,
    PmApiRateLimitError,
    PmApiUnavailableError,
)
from backend.app.services.entity_research.service import (
    LINKEDIN_FOLLOW_UP,
    NO_PUBLIC_ROLE,
    NOT_IN_NEWS,
    EntityResearchService,
    aggregate_candidates,
    authority_slugs,
    doel_payload,
    key_kind,
    key_slug,
    matching_authorities,
    mention_contexts,
    span_matches,
    status_from_doel,
)
from backend.tests.unit._exploration_fixtures import make_session_factory, make_settings
from backend.tests.unit._pm_fixtures import create_pm_database

NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
UPDATED = NOW - timedelta(days=1)

DOELEN_SCHEMA = """
CREATE TABLE nieuws_doelen (id INTEGER PRIMARY KEY, sleutel TEXT UNIQUE, naam TEXT, soort TEXT,
    status TEXT, vervolg TEXT, verslag TEXT, resultaat TEXT, entity_id INTEGER, prioriteit REAL,
    pogingen INTEGER DEFAULT 0, aangemaakt TEXT, bijgewerkt TEXT);
CREATE TABLE edit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, record_id INTEGER,
    action TEXT, changed_by TEXT, old_value TEXT, new_value TEXT, reason TEXT);
"""

NOS_TEXT = (
    "Windpark Dijkerhoven gaat door\n"
    "Pomme Rademaker\n"
    "redacteur Economie\n"
    "Het windpark komt er. Wethouder Anouk Verbeek zegt dat het dorp niet kan achterblijven. "
    "Omwonende Henk de Boer (61) is boos. NordVind bouwt het park."
)
AD_TEXT = "Anouk Verbeek (VVD) verdedigt het plan. Henk de Boer (61) vreest geluidsoverlast."


def spans(text: str, names: list[tuple[str, str]]) -> list[dict[str, Any]]:
    result = []
    for name, label in names:
        start = text.index(name)
        result.append({"text": name, "label": label, "start": start, "end": start + len(name)})
    return result


# ------------------------------------------------------------------ fixtures
class FakePmClient:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, Any], bool]] = []
        self.responses: dict[str, Any] = {}
        self.next_id = 100
        self.healthy = True

    async def enqueue(self, doel, *, again=False):
        self.calls.append((doel, again))
        response = self.responses.get(doel["sleutel"])
        if isinstance(response, Exception):
            raise response
        if response is not None:
            return response
        self.next_id += 1
        return {"doel": {"id": self.next_id, "status": "open"}, "created": True}

    async def health(self):
        return self.healthy


class FakeRunner:
    def __init__(self, allow: bool = True) -> None:
        self.allow = allow
        self.started = 0
        self.callback = None

    def start_round(self, on_finished=None):
        if not self.allow:
            return False
        self.started += 1
        self.callback = on_finished
        return True

    def status(self):
        return {"running": False, "rounds_today": self.started}

    async def linkedin_status(self):
        return {"automatisch": True}


def pm_database(tmp_path: Path) -> Path:
    path = create_pm_database(tmp_path)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(DOELEN_SCHEMA)
        connection.commit()
    finally:
        connection.close()
    return path


async def seed(factory) -> dict[str, int]:
    async with factory() as session:
        event = Event(
            slug="windpark-dijkerhoven",
            title="kop",
            article_count=2,
            first_seen_at=UPDATED - timedelta(days=1),
            last_updated_at=UPDATED,
        )
        old = Event(
            slug="oud-nieuws",
            title="kop",
            article_count=1,
            first_seen_at=NOW - timedelta(days=40),
            last_updated_at=NOW - timedelta(days=40),
        )
        session.add_all([event, old])
        await session.flush()
        nos = Article(
            guid="g1",
            url="https://nos.nl/artikel/1",
            title="kop",
            content=NOS_TEXT,
            source_name="NOS",
            published_at=UPDATED,
            entities=spans(
                NOS_TEXT,
                [
                    ("Pomme Rademaker", "PERSON"),
                    ("Anouk Verbeek", "PERSON"),
                    ("Henk de Boer", "PERSON"),
                    ("NordVind", "ORG"),
                ],
            ),
        )
        ad = Article(
            guid="g2",
            url="https://ad.nl/artikel/2",
            title="kop",
            content=AD_TEXT,
            source_name="AD",
            published_at=UPDATED,
            entities=spans(AD_TEXT, [("Anouk Verbeek", "PERSON"), ("Henk de Boer", "PERSON")]),
        )
        session.add_all([nos, ad])
        await session.flush()
        session.add_all(
            [
                EventArticle(event_id=event.id, article_id=nos.id),
                EventArticle(event_id=event.id, article_id=ad.id),
            ]
        )
        session.add(
            LLMInsight(
                event_id=event.id,
                provider="mistral",
                model="m",
                summary="Titel\n\nSamenvatting",
                generated_at=UPDATED,
                authority_analysis=[
                    {
                        "authority": "Anouk Verbeek",
                        "authority_type": "politicus",
                        "actual_role": "Wethouder van Dijkerhoven",
                    },
                    {
                        "authority": "Nationale Adviesraad Windenergie",
                        "authority_type": "adviesorgaan",
                        "actual_role": "Adviseert ministeries over windenergie",
                    },
                ],
            )
        )

        def entity(key, name, kind, aliases, article_ids, outlets, event_id=None, updated=UPDATED):
            return EventEntity(
                event_id=event_id or event.id,
                entity_key=key,
                name=name,
                kind=kind,
                aliases=aliases,
                mention_count=len(article_ids) * 2,
                article_count=len(article_ids),
                outlet_counts={outlet: 1 for outlet in outlets},
                article_ids=article_ids,
                salience=0.1,
                event_slug="windpark-dijkerhoven" if event_id is None else "oud-nieuws",
                event_title="Windpark Dijkerhoven",
                event_last_updated_at=updated,
            )

        session.add_all(
            [
                entity(
                    "person:anouk-verbeek",
                    "Anouk Verbeek",
                    "person",
                    ["anouk-verbeek", "verbeek"],
                    [nos.id, ad.id],
                    ["NOS", "AD"],
                ),
                entity(
                    "person:henk-de-boer",
                    "Henk de Boer",
                    "person",
                    ["henk-de-boer", "boer"],
                    [nos.id, ad.id],
                    ["NOS", "AD"],
                ),
                entity(
                    "person:pomme-rademaker",
                    "Pomme Rademaker",
                    "person",
                    ["pomme-rademaker", "rademaker"],
                    [nos.id],
                    ["NOS"],
                ),
                entity("org:nordvind", "NordVind", "org", ["nordvind"], [nos.id], ["NOS"]),
                entity("org:nos", "NOS", "org", ["nos"], [nos.id], ["NOS"]),
                entity("org:dpg-media", "DPG Media", "org", ["dpg-media"], [ad.id], ["AD"]),
                entity(
                    "place:dijkerhoven", "Dijkerhoven", "place", ["dijkerhoven"], [nos.id], ["NOS"]
                ),
                # only in an old event: not triaged automatically
                entity(
                    "person:mark-rutte",
                    "Mark Rutte",
                    "person",
                    ["mark-rutte", "rutte"],
                    [],
                    [],
                    event_id=old.id,
                    updated=NOW - timedelta(days=40),
                ),
            ]
        )
        await session.commit()
        return {"event": event.id, "nos": nos.id, "ad": ad.id}


async def make_env(tmp_path: Path) -> dict[str, Any]:
    """Session factory with seeded news, a pm database, fake pm client and runner.

    (A helper, not an async fixture: pytest-asyncio 0.21 with pytest 8 breaks async fixtures.)
    """

    factory, _engine = await make_session_factory()
    ids = await seed(factory)
    settings = make_settings(
        propaganda_db_path=str(pm_database(tmp_path)),
        entity_research_daily_targets=2,
        entity_research_daily_requests=5,
    )
    client, runner = FakePmClient(), FakeRunner()
    syncs: list[int] = []
    service = EntityResearchService(
        settings=settings,
        read_session_factory=factory,
        write_session_factory=factory,
        pm_client=client,
        runner=runner,
        pm_sync=lambda: syncs.append(1),
        clock=lambda: NOW,
    )
    return {
        "service": service,
        "factory": factory,
        "client": client,
        "runner": runner,
        "syncs": syncs,
        "ids": ids,
        "settings": settings,
    }


async def rows(factory) -> dict[str, EntityResearch]:
    async with factory() as session:
        return {
            row.entity_key: row for row in (await session.execute(select(EntityResearch))).scalars()
        }


async def request(
    factory, key: str, name: str, kind: str = "unknown", slug: str | None = None
) -> None:
    async with factory() as session:
        session.add(
            EntityResearch(
                entity_key=key,
                name=name,
                kind=kind,
                request_event_slug=slug,
                requested_count=1,
                last_requested_at=NOW - timedelta(minutes=1),
            )
        )
        await session.commit()


# ------------------------------------------------------------------ pure helpers
def test_key_helpers() -> None:
    assert key_kind("person:a") == "person" and key_kind("org:b") == "org"
    assert key_kind("actor:c") == "unknown" and key_slug("actor:c") == "c" and key_slug("x") == "x"


@pytest.mark.parametrize(
    ("span", "expected"),
    [
        ("Anouk Verbeek", True),
        ("Wethouder Anouk Verbeek", True),
        ("Anouk Verbeek van NordVind", True),  # trailing apposition in the span
        ("Verbeek", True),  # surname alias (within the event)
        ("Verbeekstraat", False),
        ("Verbeek-Jansen", False),  # never a surname prefix
        ("", False),
    ],
)
def test_span_matches(span: str, expected: bool) -> None:
    assert span_matches(span, {"anouk-verbeek", "verbeek"}) is expected


def test_mention_contexts_byline_and_limits() -> None:
    article = {
        "content": NOS_TEXT,
        "source_name": "NOS",
        "entities": spans(NOS_TEXT, [("Pomme Rademaker", "PERSON"), ("NordVind", "ORG")])
        + [
            {"label": "PERSON", "start": 5, "end": 9999},  # beyond the prefix
            {"label": "PERSON", "start": "x", "end": 3},
            "kapot",
        ],
    }
    [context] = mention_contexts(article, {"pomme-rademaker"})
    assert (
        context.line_start and context.next_line == "redacteur Economie" and context.outlet == "NOS"
    )
    assert mention_contexts({"content": "", "entities": None}, {"a"}) == []
    many = {
        "content": "A B. " * 20,
        "entities": [{"label": "PERSON", "start": i * 5, "end": i * 5 + 3} for i in range(10)],
    }
    assert len(mention_contexts(many, {"a-b"}, limit=3)) == 3


def test_authority_matching() -> None:
    assert authority_slugs("Autoriteit Consument en Markt (ACM)") == {
        "autoriteit-consument-en-markt-acm",
        "autoriteit-consument-en-markt",
        "acm",
    }
    authorities = [
        {"authority": "Anouk Verbeek"},
        {"authority": "Verbeek"},
        {"authority": ""},
        {"authority": "NordVind"},
    ]
    assert matching_authorities(authorities, {"anouk-verbeek", "verbeek"}, "person") == [
        authorities[0]
    ]
    assert matching_authorities(authorities, {"nordvind"}, "org") == [authorities[3]]


def test_status_from_doel() -> None:
    assert status_from_doel({"status": "open"}) == ("wachtrij", None)
    assert status_from_doel({"status": "klaar", "vervolg": "linkedin"}) == (
        "klaar",
        LINKEDIN_FOLLOW_UP,
    )
    assert status_from_doel({"status": "twijfel"})[1].startswith("Meerdere personen")
    assert status_from_doel({"status": "vreemd"}) == ("wachtrij", None)


def test_doel_payload() -> None:
    row = EntityResearch(
        entity_key="actor:nordvind",
        name="NordVind",
        kind="unknown",
        role_category="organisatie",
        role_label="Ontwikkelaar",
        priority=61.234,
        pm_entity_id=42,
        prominence={
            "canonical": "org:nordvind",
            "context": {
                "events": [{"slug": "windpark", "titel": "Windpark"}],
                "artikelen": [{"url": "https://nos.nl/1"}],
            },
        },
    )
    payload = doel_payload(row, base_url="https://pluriformiteit.nl/")
    assert payload["sleutel"] == "org:nordvind" and payload["soort"] == "organisatie"
    assert payload["entity_id"] == 42 and payload["prioriteit"] == 61.23
    assert payload["context"]["events"][0]["url"] == "https://pluriformiteit.nl/event/windpark"
    assert payload["context"]["organisaties"] == [] and payload["context"]["rolzinnen"] == []
    person = EntityResearch(entity_key="person:x", name="X", kind="person", prominence={})
    assert doel_payload(person)["soort"] == "persoon" and "entity_id" not in doel_payload(person)


def test_aggregate_candidates() -> None:
    def row(event_id, **kw):
        base = dict(
            event_id=event_id,
            entity_key="person:a",
            name=f"A{event_id}",
            kind="person",
            aliases=["a"],
            article_ids=[event_id, 99],
            outlet_counts={"NOS": 1},
            article_count=2,
            mention_count=3,
            event_slug=f"e{event_id}",
            event_title="T",
            event_last_updated_at=NOW - timedelta(days=event_id),
        )
        base.update(kw)
        return EventEntity(**base)

    [candidate] = aggregate_candidates([row(1), row(2, outlet_counts={"AD": 2}), row(1)]).values()
    assert candidate.name == "A1" and candidate.event_ids == [1, 2]
    assert candidate.article_ids == [1, 99, 2] and candidate.outlets == {"NOS", "AD"}
    assert candidate.articles == 6 and candidate.prominence.events == 2
    assert candidate.aliases == {"a"} and candidate.last_seen == NOW - timedelta(days=1)


# ------------------------------------------------------------------ triage
async def test_triage_assigns_roles_and_decisions(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    result = await env["service"].triage()
    assert result["assessed"] == 6  # persons/orgs of recent events; no place, no old event
    found = await rows(env["factory"])
    anouk = found["person:anouk-verbeek"]
    assert anouk.role_category == "politicus" and anouk.status == "nieuw"
    assert anouk.priority >= 60 and anouk.prominence["decision"] == prio.RESEARCH
    assert anouk.prominence["context"]["artikelen"][0]["url"].startswith("https://")
    assert any("Wethouder" in line for line in anouk.prominence["context"]["rolzinnen"])
    henk = found["person:henk-de-boer"]
    assert henk.role_category == "prive" and henk.status == "overgeslagen"
    assert henk.status_reason.startswith("Privépersoon")
    pomme = found["person:pomme-rademaker"]
    assert pomme.role_category == "journalist" and pomme.role_label == "redacteur Economie (NOS)"
    assert found["org:nordvind"].role_category == "organisatie"
    nos = found["org:nos"]
    assert nos.status == "niet_nodig" and nos.pm_degree == 4 and nos.pm_entity_id == 11
    dpg = found["org:dpg-media"]
    assert dpg.pm_degree == 2 and dpg.prominence["decision"] == prio.ON_REQUEST
    assert "person:mark-rutte" not in found and "place:dijkerhoven" not in found
    # the watermark prevents re-reading unchanged entities
    assert (await env["service"].triage())["assessed"] == 0


async def test_triage_keeps_status_of_research_in_progress(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, factory = env["service"], env["factory"]
    await service.triage()
    async with factory() as session:
        row = await session.get(EntityResearch, "person:anouk-verbeek")
        row.status, row.last_requested_at = "bezig", NOW
        await session.commit()
    await service.triage()  # re-assessed because of the tap
    assert (await rows(factory))["person:anouk-verbeek"].status == "bezig"


async def test_tap_on_name_without_public_role(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    factory = env["factory"]
    async with factory() as session:
        session.add(
            EventEntity(
                event_id=env["ids"]["event"],
                entity_key="person:jan-jansen",
                name="Jan Jansen",
                kind="person",
                aliases=["jan-jansen"],
                mention_count=1,
                article_count=1,
                outlet_counts={"AD": 1},
                article_ids=[env["ids"]["ad"]],
                salience=0.01,
                event_slug="windpark-dijkerhoven",
                event_title="Windpark",
                event_last_updated_at=UPDATED,
            )
        )
        await session.commit()
    await request(factory, "person:jan-jansen", "Jan Jansen", kind="person")
    await env["service"].triage()
    row = (await rows(factory))["person:jan-jansen"]
    assert row.role_category == "onbekend" and row.status == "overgeslagen"
    assert row.status_reason == NO_PUBLIC_ROLE


async def test_triage_resolves_taps(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, factory = env["service"], env["factory"]
    await request(factory, "actor:nordvind", "NordVind", slug="windpark-dijkerhoven")
    await request(
        factory,
        "actor:nationale-adviesraad-windenergie",
        "Nationale Adviesraad Windenergie",
        slug="windpark-dijkerhoven",
    )
    await request(factory, "actor:iemand-anders", "Iemand Anders", slug="windpark-dijkerhoven")
    await request(factory, "actor:zonder-event", "Zonder Event")
    await request(factory, "person:mark-rutte", "Mark Rutte", kind="person")  # old event, tapped
    await service.triage()
    found = await rows(factory)
    actor = found["actor:nordvind"]
    assert actor.prominence["canonical"] == "org:nordvind" and actor.role_category == "organisatie"
    adviesraad = found["actor:nationale-adviesraad-windenergie"]
    assert adviesraad.kind == "org" and adviesraad.role_category == "organisatie"
    assert adviesraad.prominence["decision"] == prio.ON_REQUEST
    for key in ("actor:iemand-anders", "actor:zonder-event"):
        assert found[key].status == "overgeslagen" and found[key].status_reason == NOT_IN_NEWS
    rutte = found["person:mark-rutte"]
    assert rutte.pm_entity_id == 23 and rutte.pm_degree == 1 and rutte.triaged_at is not None


# ------------------------------------------------------------------ enqueue
async def test_enqueue_budgets_and_order(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, factory, client = env["service"], env["factory"], env["client"]
    await service.triage()
    await request(factory, "org:dpg-media-verzoek", "x")  # not in the news -> skipped by triage
    async with factory() as session:
        dpg = await session.get(EntityResearch, "org:dpg-media")
        dpg.last_requested_at = NOW - timedelta(minutes=5)
        await session.commit()
    await service.triage()
    result = await service.enqueue()
    sent = [doel["sleutel"] for doel, _again in client.calls]
    # the tap first, then the two highest automatic priorities (budget 2)
    assert sent == ["org:dpg-media", "person:anouk-verbeek", "person:pomme-rademaker"]
    assert result["queued"] == 3 and result["skipped"]["budget_auto"] == 1
    found = await rows(factory)
    assert (
        found["person:anouk-verbeek"].status == "wachtrij"
        and found["person:anouk-verbeek"].pm_doel_id
    )
    assert found["org:nordvind"].status == "nieuw"
    # budget used up for today
    assert (await service.enqueue())["queued"] == 0


async def test_enqueue_stops_when_pm_unavailable(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, client = env["service"], env["client"]
    await service.triage()
    client.responses["person:anouk-verbeek"] = PmApiUnavailableError("down")
    result = await service.enqueue()
    assert result == {"queued": 0, "skipped": {"pm_unavailable": 1}}


async def test_enqueue_handles_errors_and_finished_targets(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, client, factory = env["service"], env["client"], env["factory"]
    await service.triage()
    client.responses["person:anouk-verbeek"] = PmApiError(500, "kapot")
    client.responses["person:pomme-rademaker"] = {
        "doel": {"id": 5, "status": "klaar"},
        "finished": True,
    }
    result = await service.enqueue()
    assert result["skipped"] == {"error": 1, "already_finished": 1}
    assert result["queued"] == 1  # nordvind
    assert (await rows(factory))["person:pomme-rademaker"].status == "klaar"
    client.responses["org:nordvind"] = PmApiRateLimitError(429, "druk")
    async with factory() as session:
        row = await session.get(EntityResearch, "org:nordvind")
        row.status, row.queued_at = "nieuw", None
        await session.commit()
    assert (await service.enqueue())["skipped"]["rate_limited"] == 1


async def test_enqueue_re_research_after_cooldown(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, client, factory = env["service"], env["client"], env["factory"]
    await service.triage()
    async with factory() as session:
        for key, status, days in (
            ("person:anouk-verbeek", "klaar", 40),
            ("person:pomme-rademaker", "klaar", 3),
            ("org:nordvind", "fout", 2),
        ):
            row = await session.get(EntityResearch, key)
            row.status, row.researched_at = status, NOW - timedelta(days=days)
        await session.commit()
    await service.enqueue()
    assert {doel["sleutel"]: again for doel, again in client.calls} == {
        "person:anouk-verbeek": True,
        "org:nordvind": True,
    }


# ------------------------------------------------------------------ status
async def test_sync_status_pulls_the_research_queue(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, factory, settings = env["service"], env["factory"], env["settings"]
    await service.triage()
    await service.enqueue()
    connection = sqlite3.connect(settings.propaganda_db_path)
    try:
        connection.execute(
            "INSERT INTO entities (id, name, type, status, vervangen) "
            "VALUES (40, 'Anouk Verbeek', 'persoon', 'goedgekeurd', 0)"
        )
        connection.execute(
            "INSERT INTO relations (id, source_id, target_id, relation_type, mechanism_id, "
            "status, vervangen) VALUES (120, 40, 2, 'personeel', 1, 'goedgekeurd', 0)"
        )
        connection.execute(
            "INSERT INTO edit_log (table_name, record_id, action, changed_by, new_value) VALUES "
            "('relations', 120, 'updated', 'nieuws-autokeur', '{\"status\": \"goedgekeurd\"}')"
        )
        connection.executemany(
            "INSERT INTO nieuws_doelen (id, sleutel, naam, status, vervolg, verslag, resultaat, "
            "bijgewerkt) VALUES (?,?,?,?,?,?,?,?)",
            [
                (
                    1,
                    "person:anouk-verbeek",
                    "Anouk Verbeek",
                    "klaar",
                    "linkedin",
                    "Wethouder.  Twee verbanden.",
                    json.dumps({"entity_ids": [40], "relation_ids": [120]}),
                    "2026-09-30T11:00:00",
                ),
                (
                    2,
                    "person:pomme-rademaker",
                    "Pomme Rademaker",
                    "bezig",
                    None,
                    None,
                    None,
                    "2026-09-30T11:00:00",
                ),
            ],
        )
        connection.commit()
    finally:
        connection.close()
    result = await service.sync_status()
    assert result == {"updated": 2, "new_auto_approved": 1}
    assert env["syncs"] == [1]
    found = await rows(factory)
    anouk = found["person:anouk-verbeek"]
    assert anouk.status == "klaar" and anouk.status_reason == LINKEDIN_FOLLOW_UP
    assert anouk.found == {"entities": 1, "relations": 1, "auto_approved": 1, "pending": 0}
    assert (
        anouk.pm_entity_id == 40
        and anouk.summary == "Wethouder. Twee verbanden."
        and anouk.researched_at
    )
    assert found["person:pomme-rademaker"].status == "bezig"
    # nothing new approved on the next pull -> no extra pm sync
    assert (await service.sync_status())["new_auto_approved"] == 0 and env["syncs"] == [1]


async def test_sync_status_without_pm(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service = env["service"]
    service.settings.propaganda_db_path = str(tmp_path / "missing.db")
    assert await service.sync_status() == {"skipped": True, "reason": "pm_db_missing"}


async def test_sync_status_without_queue_table(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service = env["service"]
    await service.triage()
    await service.enqueue()
    service.settings.propaganda_db_path = str(create_pm_database(tmp_path / "zonder"))
    assert await service.sync_status() == {"skipped": True, "reason": "pm_queue_missing"}


# ------------------------------------------------------------------ cycle, rounds, admin
async def test_run_cycle_starts_a_round_when_targets_wait(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, runner = env["service"], env["runner"]
    outcome = await service.run_cycle(correlation_id="t")
    assert outcome["skipped"] is False and outcome["enqueue"]["queued"] == 2
    assert outcome["round_started"] is True and runner.started == 1
    assert service.last_runs["cycle"]["round_started"] is True
    # after the round: status pulled and pm sync when something was approved
    await runner.callback(
        type(
            "State",
            (),
            {"autokeur": {"goedgekeurd": {"relations": [1]}}, "returncode": 0, "timed_out": False},
        )()
    )
    assert env["syncs"] == [1] and service.last_runs["after_round"]["returncode"] == 0


async def test_no_round_without_waiting_targets(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, runner = env["service"], env["runner"]
    assert await service.maybe_start_round() is False and runner.started == 0
    service.settings.nieuws_scout_enabled = False
    assert await service.maybe_start_round() is False


async def test_run_cycle_disabled(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    env["service"].settings.entity_research_enabled = False
    assert await env["service"].run_cycle() == {"skipped": True, "reason": "disabled"}


async def test_research_key_forces_queueing(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service, client = env["service"], env["client"]
    result = await service.research_key("person:mark-rutte")
    assert result["found"] and result["status"] == "wachtrij"
    assert [doel["sleutel"] for doel, again in client.calls] == ["person:mark-rutte"]
    assert client.calls[0][1] is True and result["round_started"] is True
    # private persons are never queued, also not by the admin
    private = await service.research_key("person:henk-de-boer")
    assert private["status"] == "overgeslagen" and private["enqueue"]["queued"] == 0
    missing = await service.research_key("person:bestaat-niet")
    assert missing == {"key": "person:bestaat-niet", "found": False, "reason": NOT_IN_NEWS}


async def test_status_overview(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service = env["service"]
    await service.run_cycle()
    status = await service.status()
    assert status["enabled"] and status["pm_db_exists"] and status["pm_server"] is True
    assert status["counts"]["wachtrij"] == 2 and status["budget"]["auto_today"] == 2
    assert status["runner"]["rounds_today"] == 1 and status["linkedin"] == {"automatisch": True}
    assert status["pm_token_present"] is False and status["watermark"]


async def test_coverage_is_cached_until_the_pm_database_changes(tmp_path: Path) -> None:
    env = await make_env(tmp_path)
    service = env["service"]
    first = service.coverage()
    assert service.coverage() is first
    service._coverage.fingerprint = "oud"
    assert service.coverage() is not first
