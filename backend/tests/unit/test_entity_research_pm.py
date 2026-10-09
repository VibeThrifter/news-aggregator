# ruff: noqa: S101
"""Propaganda-model coverage, REST client and research runner (Epic 12, Stories 12.6/12.7)."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from backend.app.services.entity_research.pm_client import (
    PmApiError,
    PmApiRateLimitError,
    PmApiUnavailableError,
    PmClient,
    read_token,
)
from backend.app.services.entity_research.pm_coverage import (
    PmCoverageIndex,
    compatible,
    read_doelen,
    research_outcome,
)
from backend.app.services.entity_research.runner import (
    NieuwsScoutRunner,
    ProcessResult,
    RunnerConfig,
    in_active_hours,
    read_run_records,
    run_process,
)
from backend.tests.unit._pm_fixtures import create_pm_database

DOELEN_SCHEMA = """
CREATE TABLE nieuws_doelen (id INTEGER PRIMARY KEY, sleutel TEXT UNIQUE, naam TEXT, soort TEXT,
    status TEXT, vervolg TEXT, verslag TEXT, resultaat TEXT, entity_id INTEGER, prioriteit REAL,
    pogingen INTEGER DEFAULT 0, aangemaakt TEXT, bijgewerkt TEXT);
CREATE TABLE edit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, record_id INTEGER,
    action TEXT, changed_by TEXT, old_value TEXT, new_value TEXT, reason TEXT);
"""


def pm_db(tmp_path: Path) -> Path:
    """Fixture pm database + queue, a pipeline person with two relations and a pending entity."""

    path = create_pm_database(tmp_path)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(DOELEN_SCHEMA)
        connection.executemany(
            "INSERT INTO entities (id, name, type, primary_role_id, status, vervangen) "
            "VALUES (?,?,?,?,?,0)",
            [
                (40, "Anouk Verbeek", "persoon", 2, "goedgekeurd"),
                (41, "Stichting Stille Polder", "stichting", None, "voorgesteld"),
                (42, "Verbeek", "bedrijf", None, "goedgekeurd"),  # same surname, organisation
            ],
        )
        connection.executemany(
            "INSERT INTO relations (id, source_id, target_id, relation_type, mechanism_id, "
            "status, vervangen) VALUES (?,?,?,?,?,?,0)",
            [
                (120, 40, 2, "personeel", 1, "goedgekeurd"),
                (121, 40, 11, "woordvoerder_van", 1, "voorgesteld"),
                (122, 40, 9, "lidmaatschap", 1, "afgewezen"),
            ],
        )
        connection.executemany(
            "INSERT INTO edit_log (table_name, record_id, action, changed_by, new_value) "
            "VALUES (?,?,?,?,?)",
            [
                ("entities", 41, "created", "nieuws-scout", '{"status": "voorgesteld"}'),
                ("entities", 40, "updated", "nieuws-autokeur", '{"status": "goedgekeurd"}'),
                ("relations", 120, "updated", "nieuws-autokeur", '{"status": "goedgekeurd"}'),
            ],
        )
        connection.executemany(
            "INSERT INTO nieuws_doelen (id, sleutel, naam, soort, status, vervolg, verslag, "
            "resultaat, entity_id, prioriteit, aangemaakt, bijgewerkt) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    1,
                    "person:anouk-verbeek",
                    "Anouk Verbeek",
                    "persoon",
                    "klaar",
                    "linkedin",
                    "Wethouder; drie verbanden.",
                    json.dumps(
                        {
                            "entity_ids": [40],
                            "relation_ids": [120, 121, 122],
                            "source_ids": [],
                            "argument_ids": [],
                        }
                    ),
                    None,
                    95.0,
                    "2026-09-30T10:00:00",
                    "2026-09-30T12:00:00",
                ),
                (
                    2,
                    "org:nordvind",
                    "NordVind",
                    "organisatie",
                    "open",
                    None,
                    None,
                    None,
                    None,
                    85.0,
                    "2026-09-30T10:00:00",
                    "2026-09-30T10:00:00",
                ),
            ],
        )
        connection.commit()
    finally:
        connection.close()
    return path


# ------------------------------------------------------------------ coverage
def test_coverage_index_lookup_and_degree(tmp_path: Path) -> None:
    index = PmCoverageIndex.load(pm_db(tmp_path))
    assert index.fingerprint
    dpg = index.lookup(["dpg-media"], "org")
    assert (
        dpg is not None and dpg.name == "DPG Media" and dpg.degree == 2
    )  # 100, 101 (105: voorgesteld target)
    nos = index.lookup(["nos"], "org")
    assert nos is not None and nos.degree == 4
    person = index.lookup(["anouk-verbeek"], "person")
    assert person is not None and person.degree == 1 and person.auto_approved is True
    # no person <-> organisation mix-ups
    assert index.lookup(["verbeek"], "person") is None
    assert index.lookup(["verbeek"], "org").id == 42
    assert index.lookup(["onbekende-naam"], None) is None
    assert index.lookup(["Mark Rutte"], "person").id == 23  # names are slugified


def test_register_officials_need_more_than_the_name(tmp_path: Path) -> None:
    """Epic 15: a local office holder the register names with initials is found by surname plus
    office plus first initial or place; never on the name alone, and a common surname needs the
    place."""

    path = create_pm_database(tmp_path)
    connection = sqlite3.connect(path)
    try:
        connection.executemany(
            "INSERT INTO entities (id, name, type, primary_role_id, status, vervangen) "
            "VALUES (?,?,'persoon',2,'goedgekeurd',0)",
            [
                (60, "B.C.M. Vostermans (burgemeester Peel en Maas)"),
                (61, "J. de Vries (wethouder Stein)"),
                (62, "J.M. de Vries (wethouder Hoorn)"),
                (63, "A. de Vries (wethouder Ede)"),
                (64, "R.S. Cazemier (burgemeester (waarnemend) Terschelling)"),
                (65, "W.J.W. Keijzer - Broers (wethouder Midden-Delfland)"),
            ],
        )
        connection.commit()
    finally:
        connection.close()
    index = PmCoverageIndex.load(path)

    def found(name: str, label: str | None, places: list[str] | None = None) -> int | None:
        info = index.lookup_official(name, label, places or [])
        return info.id if info else None

    assert found("Bert Vostermans", "burgemeester") == 60
    assert found("burgemeester Vostermans", "burgemeester", ["Peel en Maas"]) == 60
    assert found("Vostermans", "burgemeester") is None  # surname + office only
    assert found("Bert Vostermans", None) is None  # no office, no place
    assert found("Bert Vostermans", "wethouder") is None  # other office
    assert found("Bert Vostermans", "oud-burgemeester") is None  # a former mayor
    assert found("Jan de Vries", "wethouder") is None  # common surname: the place decides
    assert found("Jan de Vries", "D66-wethouder", ["Stein"]) == 61
    assert found("Jan de Vries", "wethouder", ["gemeente Hoorn"]) == 62
    assert found("Rob Cazemier", "burgemeester") == 64
    assert found("Wilma Keijzer", "wethouder") == 65  # first part of a double surname


def test_coverage_pending_scout_entities(tmp_path: Path) -> None:
    index = PmCoverageIndex.load(pm_db(tmp_path))
    assert index.is_pending(["stichting-stille-polder"]) is True
    assert index.is_pending(["nordvind"]) is False


def test_coverage_without_edit_log(tmp_path: Path) -> None:
    index = PmCoverageIndex.load(create_pm_database(tmp_path))
    assert index.pending_slugs == set()
    assert index.lookup(["dpg-media"], "org").auto_approved is False


def test_compatible() -> None:
    from backend.app.services.entity_research.pm_coverage import PmEntityInfo

    person = PmEntityInfo(1, "A", "persoon", 0)
    org = PmEntityInfo(2, "B", "bedrijf", 0)
    assert compatible(person, "person") and not compatible(person, "org")
    assert compatible(org, "org") and not compatible(org, "person")
    assert compatible(person, None) and compatible(org, "unknown")


def test_read_doelen(tmp_path: Path) -> None:
    path = pm_db(tmp_path)
    doelen = read_doelen(path, sleutels=["person:anouk-verbeek", "org:nordvind", "org:onbekend"])
    assert [doel["sleutel"] for doel in doelen] == ["person:anouk-verbeek", "org:nordvind"]
    assert doelen[0]["resultaat"]["relation_ids"] == [120, 121, 122]  # JSON decoded
    assert read_doelen(path, sleutels=[]) == []
    assert [d["id"] for d in read_doelen(path, updated_after="2026-09-30T11:00:00")] == [1]
    assert len(read_doelen(path)) == 2


def test_read_doelen_without_queue_table(tmp_path: Path) -> None:
    assert read_doelen(create_pm_database(tmp_path)) is None


def test_research_outcome(tmp_path: Path) -> None:
    path = pm_db(tmp_path)
    outcome = research_outcome(
        path,
        {"entity_ids": [40], "relation_ids": [120, 121, 122]},
        name="Anouk Verbeek",
        kind="person",
    )
    assert (
        outcome.entities,
        outcome.relations,
        outcome.auto_approved,
        outcome.pending,
        outcome.rejected,
    ) == (
        1,
        3,
        1,
        1,
        1,
    )
    assert outcome.main_entity_id == 40
    assert outcome.as_found() == {"entities": 1, "relations": 3, "auto_approved": 1, "pending": 1}
    # a single person among the created entities is the target, even with another name
    assert (
        research_outcome(
            path, {"entity_ids": [40, 42]}, name="A. Verbeek", kind="person"
        ).main_entity_id
        == 40
    )
    empty = research_outcome(path, None)
    assert empty.relations == 0 and empty.main_entity_id is None
    assert research_outcome(path, {"entity_ids": ["x"], "relation_ids": []}).entities == 0


# ------------------------------------------------------------------ REST client
def _client(handler, token: str | None = "tok") -> PmClient:  # noqa: S107 - test token
    return PmClient(
        "http://pm.test/",
        "/tokens/nieuws-agent.token",
        transport=httpx.MockTransport(handler),
        token_reader=lambda _path: token,
    )


def test_read_token(tmp_path: Path) -> None:
    token_file = tmp_path / "t.token"
    token_file.write_text(" geheim \n")
    assert read_token(token_file) == "geheim"
    assert read_token(tmp_path / "missing") is None
    (tmp_path / "empty").write_text("")
    assert read_token(tmp_path / "empty") is None


async def test_health() -> None:
    assert await _client(lambda request: httpx.Response(200, json={"ok": True})).health() is True
    assert await _client(lambda request: httpx.Response(503)).health() is False

    def boom(request):
        raise httpx.ConnectError("refused", request=request)

    assert await _client(boom).health() is False


async def test_enqueue_statuses() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = json.loads(request.content)
        if body["sleutel"] == "org:nieuw":
            return httpx.Response(201, json={"doel": {"id": 7, "status": "open"}})
        if body["sleutel"] == "org:bestaand":
            return httpx.Response(200, json={"doel": {"id": 8}, "bijgewerkt": True})
        if body["sleutel"] == "org:klaar":
            return httpx.Response(
                409, json={"error": "al onderzocht", "doel": {"id": 9, "status": "klaar"}}
            )
        if body["sleutel"] == "org:druk":
            return httpx.Response(429, json={"error": "rate limit"})
        return httpx.Response(500, text="kapot")

    client = _client(handler)
    assert await client.enqueue({"sleutel": "org:nieuw"}) == {
        "doel": {"id": 7, "status": "open"},
        "created": True,
    }
    assert (await client.enqueue({"sleutel": "org:bestaand"}))["created"] is False
    finished = await client.enqueue({"sleutel": "org:klaar"})
    assert finished["finished"] is True and finished["doel"]["id"] == 9
    with pytest.raises(PmApiRateLimitError):
        await client.enqueue({"sleutel": "org:druk"})
    with pytest.raises(PmApiError) as error:
        await client.enqueue({"sleutel": "org:x"}, again=True)
    assert error.value.status_code == 500
    assert seen[0].headers["Authorization"] == "Bearer tok"
    assert json.loads(seen[-1].content)["opnieuw"] is True


async def test_enqueue_without_token_or_server() -> None:
    with pytest.raises(PmApiUnavailableError):
        await _client(lambda request: httpx.Response(201), token=None).enqueue({"sleutel": "org:a"})

    def refused(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(PmApiUnavailableError):
        await _client(refused).enqueue({"sleutel": "org:a"})


def test_non_json_response_body() -> None:
    from backend.app.services.entity_research.pm_client import _json

    assert _json(httpx.Response(200, text="geen json")) == {}
    assert _json(httpx.Response(200, json=[1, 2])) == {}


# ------------------------------------------------------------------ runner
def pm_project(tmp_path: Path, records: list[dict] | None = None) -> Path:
    project = tmp_path / "pm"
    (project / "scripts").mkdir(parents=True)
    (project / "data").mkdir()
    (project / "tools" / "linkedin").mkdir(parents=True)
    for script in ("agent_runner.py", "nieuws_autokeur_service.py"):
        (project / "scripts" / script).write_text("# stub\n")
    (project / "tools" / "linkedin" / "snelheidsrem.py").write_text("# stub\n")
    lines = [json.dumps(record) for record in records or []]
    lines.insert(0, "geen json")
    (project / "data" / "agent_runs.jsonl").write_text("\n".join(lines) + "\n")
    return project


class FakeSpawn:
    def __init__(self, outputs: dict[str, ProcessResult] | None = None, delay: float = 0.0) -> None:
        self.calls: list[list[str]] = []
        self.outputs = outputs or {}
        self.delay = delay

    async def __call__(self, command, cwd, timeout):
        self.calls.append(list(command))
        if self.delay:
            await asyncio.sleep(self.delay)
        joined = " ".join(command)
        for marker, result in self.outputs.items():
            if marker in joined:
                return result
        return ProcessResult(0, [])


NOON = datetime(2026, 9, 30, 12, 0).astimezone()


def runner(tmp_path: Path, spawn: FakeSpawn, records=None, **config) -> NieuwsScoutRunner:
    return NieuwsScoutRunner(
        RunnerConfig(project_dir=pm_project(tmp_path, records), **config),
        spawn=spawn,
        clock=lambda: NOON,
    )


def test_in_active_hours() -> None:
    assert in_active_hours(NOON, 8, 22)
    assert not in_active_hours(NOON.replace(hour=7), 8, 22)
    assert not in_active_hours(NOON.replace(hour=22), 8, 22)


def test_read_run_records(tmp_path: Path) -> None:
    project = pm_project(
        tmp_path,
        [
            {"label": "nieuws-scout", "datum": "2026-09-30"},
            {"label": "scout-agent", "datum": "2026-09-30"},
        ],
    )
    assert read_run_records(project / "data" / "agent_runs.jsonl") == [
        {"label": "nieuws-scout", "datum": "2026-09-30"}
    ]
    assert read_run_records(tmp_path / "missing.jsonl") == []


def test_round_command(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("sys.platform", "linux")
    command = runner(tmp_path, FakeSpawn()).round_command()
    assert command[1:8] == [
        "scripts/agent_runner.py",
        "--agent",
        "nieuws-scout",
        "--label",
        "nieuws-scout",
        "--brief",
        "missies/nieuws_scout_brief.md",
    ]
    assert "--skip-permissions" in command and "--alleen-bij-open-doelen" in command
    assert command[command.index("--max-rondes-per-dag") + 1] == "4"
    assert command[command.index("--actieve-uren") + 1] == "8-22"
    assert command[command.index("--model") + 1] == "opus"
    assert command[command.index("--effort") + 1] == "high"


def test_round_command_uses_caffeinate_on_macos(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("sys.platform", "darwin")
    monkeypatch.setattr(
        "backend.app.services.entity_research.runner.shutil.which",
        lambda name: "/usr/bin/caffeinate" if name == "caffeinate" else None,
    )
    command = runner(tmp_path, FakeSpawn(), model="", effort="").round_command()
    assert command[:2] == ["/usr/bin/caffeinate", "-i"]
    assert "--model" not in command and "--effort" not in command


def test_can_start_budget_and_hours(tmp_path: Path) -> None:
    today = NOON.date().isoformat()
    records = [{"label": "nieuws-scout", "datum": today}] * 4
    assert runner(tmp_path / "a", FakeSpawn(), records).can_start() == (
        False,
        "dagbudget aan rondes bereikt",
    )
    assert runner(tmp_path / "b", FakeSpawn(), records, max_rounds_per_day=5).can_start() == (
        True,
        None,
    )
    evening = runner(tmp_path / "c", FakeSpawn())
    assert evening.can_start(NOON.replace(hour=23)) == (False, "buiten de actieve uren")
    missing = NieuwsScoutRunner(RunnerConfig(project_dir=tmp_path / "nergens"), clock=lambda: NOON)
    assert missing.can_start() == (False, "propagandamodel-project niet gevonden")


async def test_start_round_runs_autokeur_and_callback(tmp_path: Path) -> None:
    autokeur = ProcessResult(
        0, ["Auto-keur…", json.dumps({"goedgekeurd": {"entities": [40], "relations": [120]}})]
    )
    spawn = FakeSpawn(
        {"nieuws_autokeur_service.py": autokeur, "agent_runner.py": ProcessResult(0, ["klaar"])}
    )
    scout = runner(tmp_path, spawn)
    finished = []

    async def on_finished(state):
        finished.append(state)

    assert scout.start_round(on_finished) is True
    assert scout.running and scout.state.running
    # a second start while running is refused
    assert scout.start_round() is False
    await scout.wait()
    assert not scout.running and scout.state.returncode == 0 and scout.state.finished_at
    assert scout.state.autokeur == {"goedgekeurd": {"entities": [40], "relations": [120]}}
    assert "scripts/agent_runner.py" in spawn.calls[0]
    assert "scripts/nieuws_autokeur_service.py" in spawn.calls[1] and len(spawn.calls) == 2
    assert finished and finished[0] is scout.state
    # minimum gap between rounds
    assert scout.can_start() == (False, "te kort na de vorige ronde")


async def test_round_without_autokeur_and_failures(tmp_path: Path) -> None:
    spawn = FakeSpawn({"agent_runner.py": ProcessResult(1, ["fout"], timed_out=True)})
    scout = runner(tmp_path, spawn, autokeur_enabled=False)

    async def broken(state):
        raise RuntimeError("callback kapot")

    assert scout.start_round(broken) is True
    await scout.wait()  # the callback error is logged, not raised
    assert scout.state.timed_out and scout.state.returncode == 1 and scout.state.autokeur is None
    assert len(spawn.calls) == 1


async def test_round_spawn_error_is_contained(tmp_path: Path) -> None:
    async def exploding(command, cwd, timeout):
        raise OSError("geen python")

    scout = NieuwsScoutRunner(
        RunnerConfig(project_dir=pm_project(tmp_path)), spawn=exploding, clock=lambda: NOON
    )
    assert scout.start_round() is True
    await scout.wait()
    assert not scout.running and "fout: geen python" in scout.state.output_tail[-1]


async def test_run_autokeur_parsing(tmp_path: Path) -> None:
    bad = runner(tmp_path / "a", FakeSpawn({"autokeur": ProcessResult(2, ["{kapot", "tekst"])}))
    assert await bad.run_autokeur() is None
    project = pm_project(tmp_path / "b")
    (project / "scripts" / "nieuws_autokeur_service.py").unlink()
    none = NieuwsScoutRunner(
        RunnerConfig(project_dir=project), spawn=FakeSpawn(), clock=lambda: NOON
    )
    assert await none.run_autokeur() is None


async def test_linkedin_status(tmp_path: Path) -> None:
    status = {"automatisch": True, "profiel": {"uur": 1, "dag": 3, "max_uur": 2, "max_dag": 10}}
    ok = runner(
        tmp_path / "a",
        FakeSpawn({"snelheidsrem.py": ProcessResult(0, ["rem:", json.dumps(status)])}),
    )
    assert await ok.linkedin_status() == status
    garbage = runner(
        tmp_path / "b", FakeSpawn({"snelheidsrem.py": ProcessResult(0, ["geen status"])})
    )
    assert await garbage.linkedin_status() is None
    broken = runner(tmp_path / "c", FakeSpawn({"snelheidsrem.py": ProcessResult(0, ["{kapot"])}))
    assert await broken.linkedin_status() is None


def test_status(tmp_path: Path) -> None:
    today = NOON.date().isoformat()
    scout = runner(
        tmp_path,
        FakeSpawn(),
        [{"label": "nieuws-scout", "datum": today, "linkedin_verlopen": True}],
    )
    status = scout.status()
    assert status["rounds_today"] == 1 and status["max_rounds_per_day"] == 4
    assert status["active_hours"] == "08-22"
    assert status["linkedin_session_expired"] is True
    assert status["can_start"] is True and status["running"] is False


async def test_run_process_real_subprocess(tmp_path: Path, monkeypatch) -> None:
    # pytest-cov passes its settings to subprocesses; the child must not write coverage data
    for name in (
        "COV_CORE_SOURCE",
        "COV_CORE_CONFIG",
        "COV_CORE_DATAFILE",
        "COV_CORE_BRANCH",
        "COV_CORE_CONTEXT",
        "COVERAGE_PROCESS_START",
    ):
        monkeypatch.delenv(name, raising=False)
    result = await run_process(["python3", "-c", "print('hallo'); print('wereld')"], tmp_path, 20)
    assert result.returncode == 0 and result.output == ["hallo", "wereld"] and not result.timed_out
    slow = await run_process(["python3", "-c", "import time; time.sleep(5)"], tmp_path, 0.3)
    assert slow.timed_out is True
