# ruff: noqa: S101
"""Dun bewijs: evidence research for thin propaganda-model links (Epic 14, Story 14.13)."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from backend.app.db.models import (
    Article,
    Event,
    EventArticle,
    PmEntity,
    PmRelation,
    RelationResearch,
)
from backend.app.services.entity_research.pm_client import PmApiUnavailableError
from backend.app.services.entity_research.runner import (
    EVIDENCE_ACCOUNT,
    EVIDENCE_BRIEF,
    EVIDENCE_LABEL,
    NieuwsScoutRunner,
    RunnerConfig,
)
from backend.app.services.evidence_research import (
    NOT_IN_MODEL,
    WELL_SUPPORTED_REASON,
    EvidenceResearchService,
    RelationEvidence,
    doel_payload,
    fold,
    from_entity,
    host_label,
    name_tokens,
    read_relation_evidence,
    research_found,
    status_from_doel,
)
from backend.tests.unit._exploration_fixtures import make_session_factory, make_settings
from backend.tests.unit._pm_fixtures import create_pm_database

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
PBL = "Planbureau voor de Leefomgeving (PBL)"
MIGRATION_011 = (
    Path(__file__).resolve().parents[3] / "database" / "migrations" / "011_bewijs_zoeken.sql"
)

DOELEN_SCHEMA = """
CREATE TABLE nieuws_doelen (id INTEGER PRIMARY KEY, sleutel TEXT UNIQUE, naam TEXT, soort TEXT,
    status TEXT, vervolg TEXT, verslag TEXT, resultaat TEXT, entity_id INTEGER,
    relation_id INTEGER, prioriteit REAL, pogingen INTEGER DEFAULT 0, aangemaakt TEXT,
    bijgewerkt TEXT);
"""


# ------------------------------------------------------------------ pure helpers
def test_recognises_a_source_from_the_party_itself():
    assert fold("Planbureau voor de Leefomgeving") == "planbureauvoordeleefomgeving"
    assert fold("Élan Médiagroep") == "elanmediagroep"
    assert host_label("https://www.pbl.nl/actueel/nieuws/klimaatdoel") == "pbl"
    assert host_label("https://nos.nl/artikel/1") == "nos"
    assert host_label("https://www.dpgmedia.nl/jaarverslag") == "dpgmedia"
    assert host_label("niet een adres") is None
    assert name_tokens(PBL) == {"pbl", "planbureauvoordeleefomgeving"}
    assert name_tokens("RIVM") == {"rivm"}
    assert from_entity({"url": "https://www.pbl.nl/actueel/x", "kind": "persbericht"}, PBL)
    assert from_entity({"publisher": "Planbureau voor de Leefomgeving"}, PBL)
    assert from_entity({"url": "https://www.dpgmedia.nl/over"}, "DPG Media")
    # a news site about PBL is not PBL itself
    assert not from_entity({"url": "https://nos.nl/artikel/pbl-klimaat", "publisher": "NOS"}, PBL)
    assert not from_entity({"url": "https://www.pbl.nl/x"}, None)


def test_describes_what_a_thin_link_rests_on_and_what_it_lacks():
    press_release = {
        "title": "Klimaatdoel 2030 raakt uit zicht",
        "kind": "persbericht",
        "url": "https://www.pbl.nl/actueel/nieuws/klimaatdoel",
        "publisher": None,
        "cluster": None,
    }
    thin = RelationEvidence(
        id=1564,
        source_name=PBL,
        target_name="NOS",
        relation_type="beinvloeding",
        mechanism="expert_framing",
        supporting=[{"id": 2322, "status": "ongecontroleerd", "sources": [press_release]}],
    )
    assert thin.label == f"{PBL} → NOS (expert framing)"
    assert thin.evidence_line() == (
        f"1 argument vóór (niet gecontroleerd); 1 bron: persbericht van {PBL} zelf; "
        "niets ertegen ingebracht"
    )
    assert thin.missing() == [
        f"een bron die niet van {PBL} zelf komt",
        "een tweede, onafhankelijke bron",
        "controle of de bron de claim werkelijk draagt",
        "tegenbewijs: er is nog niets tegenin gebracht",
    ]
    empty = RelationEvidence(
        id=220,
        source_name="RIVM",
        target_name="de Volkskrant",
        relation_type="beinvloeding",
        disputed=1,
    )
    assert empty.evidence_line() == "geen geldig argument vóór; 1 betwist; niets ertegen ingebracht"
    assert empty.missing()[0] == "een geldig argument met een bron die de claim draagt"


def test_reads_the_evidence_of_relations_from_the_propaganda_model(tmp_path):
    db = create_pm_database(tmp_path)
    evidence = read_relation_evidence(db, [100, 101, 104, 106, 107, 110, 999])
    # 107 is replaced, 999 does not exist; 106 is only proposed
    assert set(evidence) == {100, 101, 104, 106, 110}
    assert evidence[106].approved is False

    ownership = evidence[100]
    # 1 (verified) and 2 (aspect 'existence') count; 3 is a supporting reply, 14 replaced,
    # 15 under the smaad hold; 4 is a counter-argument
    assert [argument["id"] for argument in ownership.supporting] == [1, 2]
    assert ownership.verified and ownership.against == 1 and ownership.origins == 2
    assert not ownership.own_sources_only
    assert from_entity(ownership.supporting[1]["sources"][0], "DPG Media")
    assert "controle of de bron de claim werkelijk draagt" not in ownership.missing()

    # 13 waits for review; 16 is about the strength of the influence, not the link itself
    volkskrant = evidence[101]
    assert [argument["id"] for argument in volkskrant.supporting] == [5]
    assert volkskrant.pending == 1

    # a counter reply by the maintainer counts against
    assert evidence[110].against == 1
    # the excluded layer (machtsvalentie) never counts
    assert [argument["id"] for argument in evidence[104].supporting] == [9]
    assert len(evidence[104].sources) == 3
    assert read_relation_evidence(db, []) == {}


def test_counts_what_a_finished_research_target_produced(tmp_path):
    db = create_pm_database(tmp_path)
    # 13 waits (voorgesteld), 5 is merged, 999 is unknown
    found = research_found(db, {"argument_ids": [13, 5, 999], "source_ids": [12]})
    assert found == {"arguments": 3, "sources": 1, "pending": 1, "merged": 1, "rejected": 0}
    assert research_found(db, None)["arguments"] == 0
    assert status_from_doel({"status": "open"}) == "wachtrij"
    assert status_from_doel({"status": "niets_gevonden"}) == "niets_gevonden"
    assert status_from_doel({}) == "wachtrij"


def test_the_research_target_is_built_from_trusted_data_only():
    evidence = RelationEvidence(
        id=110,
        source_name="Mediahuis",
        target_name="NOS",
        relation_type="adverteerder",
        mechanism="commerciele_afhankelijkheid",
    )
    row = RelationResearch(relation_id=110, requested_count=3, request_events=["westnijlvirus"])
    events = [
        {
            "slug": "westnijlvirus",
            "titel": "Westnijlvirus in Nederland",
            "artikelen": [{"url": "https://nos.nl/1", "bron": "NOS", "titel": "t", "datum": None}],
        }
    ]
    payload = doel_payload(evidence, row, events, "https://pluriformiteit.nl/")
    assert payload["sleutel"] == "relatie:110" and payload["soort"] == "relatie"
    assert payload["relation_id"] == 110
    assert payload["naam"] == "Mediahuis → NOS (commerciele afhankelijkheid)"
    assert payload["context"]["events"] == [
        {
            "slug": "westnijlvirus",
            "titel": "Westnijlvirus in Nederland",
            "url": "https://pluriformiteit.nl/event/westnijlvirus",
        }
    ]
    assert payload["context"]["artikelen"][0]["url"] == "https://nos.nl/1"
    assert payload["context"]["bewijs"].startswith("geen geldig argument vóór")
    assert payload["context"]["ontbreekt"]
    assert payload["prioriteit"] > 50


def test_runner_starts_the_evidence_agent_with_its_own_label_and_queue(tmp_path):
    runner = NieuwsScoutRunner(
        RunnerConfig(
            project_dir=tmp_path,
            label=EVIDENCE_LABEL,
            account=EVIDENCE_ACCOUNT,
            brief=EVIDENCE_BRIEF,
            extra_args=("--doel-soort", "relatie"),
            autokeur_enabled=False,
        )
    )
    command = runner.round_command()
    assert command[command.index("--agent") + 1] == "nieuws-bewijs"
    assert command[command.index("--label") + 1] == "nieuws-bewijs"
    assert command[command.index("--brief") + 1] == "missies/nieuws_bewijs_brief.md"
    assert command[command.index("--doel-soort") + 1] == "relatie"
    # only rounds of its own label count against its budget
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "agent_runs.jsonl").write_text(
        "\n".join(
            json.dumps({"label": label, "datum": datetime.now().date().isoformat()})
            for label in ("nieuws-scout", "nieuws-scout", "nieuws-bewijs")
        )
    )
    assert runner.rounds_today() == 1


def test_migration_011_is_secured_and_validates_what_readers_send():
    sql = MIGRATION_011.read_text()
    assert "ALTER TABLE relation_research ENABLE ROW LEVEL SECURITY" in sql
    assert "REVOKE ALL ON relation_research FROM PUBLIC, anon, authenticated" in sql
    for function in (
        "relation_research_status(integer[])",
        "request_relation_research(integer[], text)",
    ):
        assert f"GRANT EXECUTE ON FUNCTION {function} TO anon, authenticated" in sql
    assert sql.count("\nSECURITY DEFINER\n") == 2
    # never the agent report, at most 12 / 40 ids, slug checked, well-supported links ignored
    status_function = sql.split("FUNCTION relation_research_status(p_ids")[1].split("$$;")[0]
    assert "summary" not in status_function
    assert "LIMIT 12" in sql and "LIMIT 40" in sql
    assert re.search(r"v_slug !~ '\^\[A-Za-z0-9_-\]\+\$'", sql)
    assert "<> 'onderbouwd'" in sql
    assert "interval '10 minutes'" in sql and "v_recent < 300" in sql


# ------------------------------------------------------------------ service
class FakePmClient:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, Any], bool]] = []
        self.prioritised: list[list[int]] = []
        self.fail: Exception | None = None
        self.next_id = 500

    async def enqueue(self, doel, *, again=False):
        if self.fail is not None:
            raise self.fail
        self.calls.append((doel, again))
        self.next_id += 1
        return {"doel": {"id": self.next_id, "status": "open"}, "created": True}

    async def health(self):
        return True

    async def prioritise(self, relation_ids):
        if self.fail is not None:
            raise self.fail
        self.prioritised.append(list(relation_ids))
        return len(relation_ids)


class FakeRunner:
    def __init__(self) -> None:
        self.started = 0

    def start_round(self, on_finished=None):
        self.started += 1
        return True

    def status(self):
        return {"running": False, "rounds_today": self.started}


def pm_database(tmp_path: Path) -> Path:
    path = create_pm_database(tmp_path)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(DOELEN_SCHEMA)
        connection.commit()
    finally:
        connection.close()
    return path


async def seed(factory) -> None:
    async with factory() as session:
        event = Event(
            slug="westnijlvirus",
            title="Westnijlvirus in Nederland",
            article_count=1,
            first_seen_at=NOW - timedelta(days=1),
            last_updated_at=NOW,
        )
        session.add(event)
        await session.flush()
        article = Article(
            guid="g1",
            url="https://nos.nl/artikel/1",
            title="Westnijlvirus vastgesteld",
            content="tekst",
            source_name="NOS",
            published_at=NOW,
        )
        session.add(article)
        await session.flush()
        session.add(EventArticle(event_id=event.id, article_id=article.id))
        session.add_all(
            [
                PmEntity(id=1, name="DPG Media", slug="dpg-media", type="mediaorganisatie"),
                PmEntity(id=2, name="Mediahuis", slug="mediahuis", type="mediaorganisatie"),
                PmEntity(id=3, name="AD", slug="ad", type="mediaorganisatie"),
                PmEntity(id=4, name="de Volkskrant", slug="de-volkskrant", type="mediaorganisatie"),
                PmEntity(id=11, name="NOS", slug="nos", type="omroep"),
            ]
        )
        await session.flush()
        session.add_all(
            [
                PmRelation(
                    id=100,
                    source_id=1,
                    target_id=3,
                    relation_type="eigendom",
                    certainty_label="onderbouwd",
                ),
                PmRelation(
                    id=101,
                    source_id=1,
                    target_id=4,
                    relation_type="eigendom",
                    certainty_label="aannemelijk",
                ),
                PmRelation(
                    id=110,
                    source_id=2,
                    target_id=11,
                    relation_type="adverteerder",
                    certainty_label="aannemelijk",
                ),
            ]
        )
        session.add_all(
            [
                # requested now, from the event
                RelationResearch(
                    relation_id=110,
                    requested_count=4,
                    last_requested_at=NOW,
                    request_events=["westnijlvirus", "onbekend-bericht"],
                ),
                RelationResearch(relation_id=101, requested_count=1, last_requested_at=NOW),
                # well supported by now, and gone from the model
                RelationResearch(relation_id=100, requested_count=1, last_requested_at=NOW),
                RelationResearch(relation_id=999, requested_count=1, last_requested_at=NOW),
                # requested too long ago
                RelationResearch(
                    relation_id=104, requested_count=9, last_requested_at=NOW - timedelta(days=30)
                ),
            ]
        )
        await session.commit()


async def make_service(tmp_path, **settings):
    # Rounds off unless a test switches them on (the developer's .env may have them on)
    settings.setdefault("nieuws_bewijs_enabled", False)
    factory, engine = await make_session_factory()
    await seed(factory)
    db = pm_database(tmp_path)
    client, runner = FakePmClient(), FakeRunner()
    service = EvidenceResearchService(
        settings=make_settings(propaganda_db_path=str(db), **settings),
        write_session_factory=factory,
        read_session_factory=factory,
        pm_client=client,
        runner=runner,
        clock=lambda: NOW,
    )
    return service, factory, engine, db, client, runner


async def rows(factory) -> dict[int, RelationResearch]:
    async with factory() as session:
        result = await session.execute(RelationResearch.__table__.select())
        return {row.relation_id: row for row in result.all()}


@pytest.mark.asyncio
async def test_queues_requested_thin_links_with_their_news_within_the_budget(tmp_path):
    service, factory, engine, _, client, runner = await make_service(
        tmp_path, evidence_research_daily_targets=1
    )
    try:
        outcome = await service.run_cycle()
        assert outcome["enqueue"]["queued"] == 1
        assert outcome["enqueue"]["skipped"] == {
            "not_in_model": 1,
            "well_supported": 1,
            "budget": 1,
        }
        # most demand first: 110 (requested 4 times) gets the only slot of the day
        doel, again = client.calls[0]
        assert doel["sleutel"] == "relatie:110" and again is False
        assert doel["context"]["events"][0]["titel"] == "Westnijlvirus in Nederland"
        assert doel["context"]["artikelen"][0]["url"] == "https://nos.nl/artikel/1"
        # the unknown slug the reader sent never reaches the agent
        assert "onbekend-bericht" not in json.dumps(doel)
        state = await rows(factory)
        assert state[110].status == "wachtrij" and state[110].pm_doel_id == 501
        assert state[100].status == "niet_nodig"
        assert state[100].status_reason == WELL_SUPPORTED_REASON
        assert state[999].status == "overgeslagen" and state[999].status_reason == NOT_IN_MODEL
        assert state[101].status == "nieuw"  # waits for tomorrow's budget
        assert state[104].status == "nieuw"  # requested too long ago
        # rounds are off until the owner switches them on
        assert outcome["round_started"] is False and runner.started == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_tells_the_propaganda_model_which_links_readers_see(tmp_path):
    service, factory, engine, _, client, _ = await make_service(
        tmp_path, evidence_research_daily_targets=1
    )
    try:
        outcome = await service.run_cycle()
        # beyond the research budget too, but not what is well supported, gone or stale
        assert client.prioritised == [[101, 110]]
        assert outcome["prioritised"] == {"sent": 2}
        await service.run_cycle()
        assert client.prioritised == [[101, 110]]  # nothing new requested since
        later = NOW + timedelta(minutes=15)
        async with factory() as session:
            row = await session.get(RelationResearch, 101)
            row.last_requested_at = later - timedelta(minutes=5)
            await session.commit()
        service._clock = lambda: later
        client.fail = PmApiUnavailableError("down")
        outcome = await service.run_cycle()
        assert outcome["prioritised"]["sent"] == 0 and "error" in outcome["prioritised"]
        client.fail = None
        await service.run_cycle()
        assert client.prioritised[-1] == [101]  # retried after the failure, only the new one
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_pulls_the_outcome_and_starts_rounds_only_when_switched_on(tmp_path):
    service, factory, engine, db, client, runner = await make_service(
        tmp_path, nieuws_bewijs_enabled=True
    )
    try:
        await service.run_cycle()
        assert runner.started == 1  # targets are waiting and rounds are on
        connection = sqlite3.connect(db)
        connection.execute(
            "INSERT INTO nieuws_doelen (sleutel, naam, soort, status, verslag, resultaat, "
            "relation_id) VALUES ('relatie:110', 'x', 'relatie', 'klaar', ?, ?, 110)",
            (
                "Bron draagt de claim niet; twee berichten gevonden.",
                json.dumps({"argument_ids": [13, 5], "source_ids": [12]}),
            ),
        )
        connection.execute(
            "INSERT INTO nieuws_doelen (sleutel, naam, soort, status, relation_id) "
            "VALUES ('relatie:101', 'x', 'relatie', 'bezig', 101)"
        )
        connection.commit()
        connection.close()
        outcome = await service.sync_status()
        assert outcome == {"updated": 2}
        state = await rows(factory)
        assert state[110].status == "klaar"
        assert state[110].found == {
            "arguments": 2,
            "sources": 1,
            "pending": 1,
            "merged": 1,
            "rejected": 0,
        }
        assert state[110].summary.startswith("Bron draagt de claim niet")
        assert state[110].researched_at is not None
        assert state[101].status == "bezig"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_admin_can_queue_one_link_now_and_the_pm_may_be_down(tmp_path):
    service, factory, engine, _, client, _ = await make_service(
        tmp_path, evidence_research_daily_targets=0
    )
    try:
        missing = await service.research_relation(999)
        assert missing == {"relation_id": 999, "found": False, "reason": NOT_IN_MODEL}
        result = await service.research_relation(104)  # ignores the budget and the window
        assert result["found"] and result["status"] == "wachtrij"
        assert result["label"] == "AD (Algemeen Dagblad) → NOS (publieke aanval)"
        assert client.calls[-1][1] is True  # forced: reopens a finished target in the pm
        client.fail = PmApiUnavailableError("down")
        outcome = await service.enqueue(110, force=True)
        assert outcome == {"queued": 0, "skipped": {"pm_unavailable": 1}}
        status = await service.status()
        assert status["rounds_enabled"] is False and status["counts"]["wachtrij"] == 1
    finally:
        await engine.dispose()


# ------------------------------------------------------------------ admin endpoints
class _StubEvidenceService:
    def __init__(self, behaviour: str = "ok") -> None:
        self.behaviour = behaviour
        self.ids: list[int] = []

    async def run_cycle(self, correlation_id: str | None = None):
        if self.behaviour == "error":
            raise RuntimeError("kapot")
        return {
            "skipped": False,
            "status": {"updated": 0},
            "enqueue": {"queued": 1, "skipped": {}},
            "round_started": False,
        }

    async def research_relation(self, relation_id: int, correlation_id: str | None = None):
        self.ids.append(relation_id)
        if relation_id == 999:
            return {"relation_id": 999, "found": False, "reason": NOT_IN_MODEL}
        return {
            "relation_id": relation_id,
            "found": True,
            "label": "PBL → NOS (expert framing)",
            "evidence": "1 argument vóór",
            "missing": ["controle"],
            "status": "wachtrij",
            "round_started": False,
        }

    async def status(self):
        return {
            "enabled": True,
            "rounds_enabled": False,
            "pm_db": "/pm.db",
            "pm_db_exists": True,
            "pm_server": True,
            "counts": {"wachtrij": 1},
            "budget": {"queued_today": 1, "max_per_day": 6},
            "runner": {"running": False},
            "last_runs": {"cycle": None},
        }


@pytest.mark.asyncio
async def test_admin_endpoints_for_evidence_research(monkeypatch):
    from fastapi import HTTPException

    from backend.app.routers import admin

    stub = _StubEvidenceService()
    monkeypatch.setattr(admin, "get_evidence_research_service", lambda: stub)
    cycle = await admin.trigger_evidence_research()
    assert cycle.enqueue == {"queued": 1, "skipped": {}} and cycle.round_started is False
    one = await admin.trigger_evidence_research_relation(1564)
    assert one.status == "wachtrij" and one.missing == ["controle"] and stub.ids == [1564]
    with pytest.raises(HTTPException) as missing:
        await admin.trigger_evidence_research_relation(999)
    assert missing.value.status_code == 404
    status = await admin.evidence_research_status()
    assert status.rounds_enabled is False and status.budget["max_per_day"] == 6
    broken_service = _StubEvidenceService("error")
    monkeypatch.setattr(admin, "get_evidence_research_service", lambda: broken_service)
    with pytest.raises(HTTPException) as broken:
        await admin.trigger_evidence_research()
    assert broken.value.status_code == 500


@pytest.mark.asyncio
async def test_after_a_round_the_automatic_review_decides_and_the_app_syncs(tmp_path):
    from backend.app.services.entity_research.runner import AUTOMATIC_REVIEW_SCRIPT, RoundState

    factory, engine = await make_session_factory()
    syncs: list[int] = []
    try:
        service = EvidenceResearchService(
            settings=make_settings(propaganda_db_path=str(pm_database(tmp_path))),
            write_session_factory=factory,
            read_session_factory=factory,
            pm_client=FakePmClient(),
            pm_sync=lambda: syncs.append(1),
            clock=lambda: NOW,
        )
        # The real runner of the service runs the pm's automatic review after a round
        config = service.runner.config
        assert config.autokeur_enabled and config.autokeur_script == AUTOMATIC_REVIEW_SCRIPT
        command = service.runner.autokeur_command()
        assert command[1:] == [AUTOMATIC_REVIEW_SCRIPT, "--once", "--json"]
        assert config.autokeur_timeout_seconds > config.timeout_seconds
        # nothing merged: no extra sync; merged evidence: sync right away
        await service._after_round(RoundState(returncode=0, autokeur={"gemerged": 0}))
        assert syncs == []
        await service._after_round(RoundState(returncode=0, autokeur={"gemerged": 3}))
        await service._after_round(
            RoundState(returncode=0, autokeur={"gemerged": 0, "goedgekeurd": {"relations": 1}})
        )
        assert syncs == [1, 1]
        assert service.last_runs["after_round"]["review"]["goedgekeurd"] == {"relations": 1}
    finally:
        await engine.dispose()
