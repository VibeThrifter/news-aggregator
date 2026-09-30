# ruff: noqa: S101
"""Tests for the demo slice builder and scripts/export_pm_demo_slice.py (Story 11.17)."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

from backend.app.services import propaganda_model_sync as pm
from backend.app.services.propaganda_model_sync import (
    build_demo_slice,
    dump_demo_slice,
    load_snapshot,
)
from backend.tests.unit._pm_fixtures import create_pm_database

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts" / "export_pm_demo_slice.py"
DEMO_FILE = REPO / "frontend" / "lib" / "explore" / "fixtures" / "demo-pm.json"
SEEDS = [11, 7, 3, 9, 4, 342, 248, 1, 2]


@pytest.fixture()
def pm_db(tmp_path: Path) -> Path:
    return create_pm_database(tmp_path / "propaganda-model")


@pytest.fixture()
def snapshot(pm_db: Path) -> pm.PmSnapshot:
    return load_snapshot(pm_db)


def _load_script():
    spec = importlib.util.spec_from_file_location("export_pm_demo_slice", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_slice_shape(snapshot: pm.PmSnapshot) -> None:
    data = build_demo_slice(snapshot, SEEDS)
    assert set(data) == {"meta", "entities", "relations", "sources", "aliases"}
    assert set(data["meta"]) == {"version", "synced_at", "entity_count", "relation_count"}
    assert data["meta"]["entity_count"] == len(snapshot.entities)  # whole model, not the slice
    assert set(data["entities"][0]) == {
        "id",
        "name",
        "slug",
        "type",
        "role",
        "primary_filter",
        "description",
        "active_from",
        "active_until",
        "degree",
    }
    assert set(data["relations"][0]) == {
        "id",
        "source_id",
        "target_id",
        "relation_type",
        "mechanism",
        "filter",
        "filters",
        "aard",
        "description",
        "certainty_label",
        "active_from",
        "active_until",
        "bidirectional",
        "source_count",
    }
    relations = {relation["id"]: relation for relation in data["relations"]}
    assert relations[103]["filters"] == ["sourcing", "ideologie"]
    assert all(isinstance(relation["filters"], list) for relation in data["relations"])
    for key, rows in data["sources"].items():
        assert re.fullmatch(r"(entity|relation):\d+", key)
        for row in rows:
            assert set(row) == {"title", "url", "publisher", "published_at", "quote"}
    entity_ids = {entity["id"] for entity in data["entities"]}
    relation_ids = {relation["id"] for relation in data["relations"]}
    for relation in data["relations"]:
        assert {relation["source_id"], relation["target_id"]} <= entity_ids
    for key in data["sources"]:
        kind, owner = key.split(":")
        assert int(owner) in (entity_ids if kind == "entity" else relation_ids)
    assert {alias["entity_id"] for alias in data["aliases"]} <= entity_ids
    # seeds present in the model are all included (342/248 do not exist in the fixture)
    assert {11, 7, 3, 9, 4, 1, 2} <= entity_ids
    # 1-hop only: unrelated entities stay out
    assert entity_ids.isdisjoint({22, 25, 26})
    serialised = json.dumps(data, ensure_ascii=False)
    assert re.search(r"politieke_positie|machtsvalentie", serialised, re.IGNORECASE) is None


def test_slice_second_hop_for_owners() -> None:
    def entity(entity_id: int) -> dict:
        return {
            "id": entity_id,
            "name": f"E{entity_id}",
            "slug": str(entity_id),
            "type": "bedrijf",
            "role": None,
            "primary_filter": None,
            "description": None,
            "active_from": None,
            "active_until": None,
            "degree": 1,
        }

    def relation(rid: int, source: int, target: int, kind: str, count: int = 0) -> dict:
        return {
            "id": rid,
            "source_id": source,
            "target_id": target,
            "relation_type": kind,
            "mechanism": None,
            "filter": None,
            "filters": [],
            "aard": None,
            "description": None,
            "certainty_label": "onzeker",
            "active_from": None,
            "active_until": None,
            "bidirectional": False,
            "source_count": count,
        }

    snapshot = pm.PmSnapshot(
        entities=[entity(i) for i in range(1, 10)],
        relations=[
            relation(1, 2, 1, "eigendom"),  # owner 2 owns seed 1
            relation(2, 3, 2, "eigendom"),  # 3 owns the owner (up the chain)
            relation(3, 2, 4, "financiering"),  # the owner's other holding (sideways)
            relation(4, 5, 2, "personeel"),  # not an ownership edge -> no second hop
            relation(5, 1, 6, "personeel"),  # 1-hop, generic
            relation(6, 7, 1, "flak", 2),  # 1-hop, informative
            relation(7, 3, 8, "eigendom"),  # third hop: never
        ],
        sources=[
            {
                "owner_kind": "relation",
                "owner_id": 1,
                "title": f"T{i}",
                "url": None,
                "publisher": None,
                "published_at": None,
                "quote": None,
                "position": i,
            }
            for i in range(5)
        ],
        aliases=[{"alias": "e1", "entity_id": 1}, {"alias": "e8", "entity_id": 8}],
        meta={"version": "v", "synced_at": "s", "entity_count": "9", "relation_count": "7"},
        synced_at=None,  # type: ignore[arg-type]
    )
    full = build_demo_slice(snapshot, [1, 99], max_sources_per_owner=3)
    assert {r["id"] for r in full["relations"]} == {1, 2, 3, 5, 6}
    assert {e["id"] for e in full["entities"]} == {1, 2, 3, 4, 6, 7}
    assert len(full["sources"]["relation:1"]) == 3
    assert full["aliases"] == [{"alias": "e1", "entity_id": 1}]

    # caps: ownership chain first, then informative 1-hop edges, then the rest
    capped = build_demo_slice(snapshot, [1], max_entities=4, max_relations=3)
    assert [r["id"] for r in capped["relations"]] == [1, 2, 6]
    assert len(capped["entities"]) == 4
    one = build_demo_slice(snapshot, [1], max_relations=1)
    assert [r["id"] for r in one["relations"]] == [1]


def _filter_snapshot() -> pm.PmSnapshot:
    """Seed 1 with 10 ownership edges (eigendom) and 8 low-priority edges per other filter."""

    def entity(entity_id: int) -> dict:
        return {"id": entity_id, "name": f"E{entity_id}", "degree": 1}

    relations = [
        {
            "id": rid,
            "source_id": 1,
            "target_id": 100 + rid,
            "relation_type": "eigendom",
            "filter": "eigendom",
            "filters": ["eigendom"],
            "source_count": 0,
        }
        for rid in range(1, 11)
    ]
    for offset, flt in enumerate(("sourcing", "ideologie"), start=1):
        for index in range(8):
            rid = offset * 100 + index
            relations.append(
                {
                    "id": rid,
                    "source_id": 1000 + rid,
                    "target_id": 1,
                    "relation_type": "personeel",
                    "filter": flt,
                    "filters": [flt, "flak"] if index == 0 else [flt],
                    "source_count": 8 - index,
                }
            )
    ids = {1} | {rel["source_id"] for rel in relations} | {rel["target_id"] for rel in relations}
    return pm.PmSnapshot(
        entities=[entity(i) for i in sorted(ids)],
        relations=relations,
        sources=[],
        aliases=[],
        meta={"version": "v", "synced_at": "s"},
        synced_at=None,  # type: ignore[arg-type]
    )


def test_slice_represents_every_filter_around_each_seed() -> None:
    snapshot = _filter_snapshot()
    # without the per-filter tier the ownership edges would fill the relation cap first
    old = build_demo_slice(snapshot, [1], max_relations=14, per_filter=0)
    assert [rel["filter"] for rel in old["relations"]].count("eigendom") == 10
    data = build_demo_slice(snapshot, [1], max_relations=14)
    counts = {
        flt: sum(1 for rel in data["relations"] if flt in rel["filters"])
        for flt in ("eigendom", "sourcing", "ideologie", "flak")
    }
    # round-robin over the filters: rank 0 = edges 1 (eigendom), 100 (sourcing, also flak) and
    # 200 (ideologie, also flak), rank 1 = 2, 101, 201, ... until the cap of 14
    assert counts == {"eigendom": 5, "sourcing": 5, "ideologie": 4, "flak": 2}
    assert {rel["id"] for rel in data["relations"]} == {1, 2, 3, 4, 5} | set(range(100, 105)) | {
        200,
        201,
        202,
        203,
    }
    # with room: up to per_filter (6) per filter, then the remaining edges fill the caps
    full = build_demo_slice(snapshot, [1], max_relations=18)
    ids = [rel["id"] for rel in full["relations"]]
    assert sum(1 for rid in ids if rid < 100) == 6
    assert sum(1 for rid in ids if 100 <= rid < 200) == 6
    assert sum(1 for rid in ids if rid >= 200) == 6


def test_slice_filters_on_the_fixture(snapshot: pm.PmSnapshot) -> None:
    data = build_demo_slice(snapshot, SEEDS, per_filter=1)
    touching = [
        rel for rel in data["relations"] if 11 in (rel["source_id"], rel["target_id"])
    ]  # NOS: sourcing, ideologie (103), flak (104), tegenmacht (108), advertentie (110)
    covered = {flt for rel in touching for flt in rel["filters"]}
    assert covered == {"sourcing", "ideologie", "flak", "tegenmacht", "advertentie"}


def test_dump_demo_slice_roundtrip(snapshot: pm.PmSnapshot) -> None:
    data = build_demo_slice(snapshot, SEEDS)
    text = dump_demo_slice(data)
    assert json.loads(text) == data
    assert text.count("\n") > len(data["entities"])  # one row per line
    empty = {"meta": data["meta"], "entities": [], "relations": [], "sources": {}, "aliases": []}
    assert json.loads(dump_demo_slice(empty)) == empty


def test_export_script(pm_db: Path, tmp_path: Path, capsys) -> None:
    module = _load_script()
    out = tmp_path / "out" / "demo-pm.json"
    assert module.main(["--db", str(pm_db), "--out", str(out)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert {e["id"] for e in data["entities"]} >= {1, 2, 3, 4, 7, 9, 11}
    printed = capsys.readouterr().out
    assert "WARNING: seed 342" in printed and "Wrote" in printed


def test_export_script_shrinks_or_fails_on_size(pm_db: Path, tmp_path: Path) -> None:
    module = _load_script()
    out = tmp_path / "demo-pm.json"
    assert module.main(["--db", str(pm_db), "--out", str(out), "--max-bytes", "10"]) == 1
    assert not out.exists()


def test_committed_demo_slice() -> None:
    """frontend/lib/explore/fixtures/demo-pm.json: shape, filters, size, excluded layers."""

    if not DEMO_FILE.exists():
        pytest.skip("demo-pm.json not generated")
    text = DEMO_FILE.read_text(encoding="utf-8")
    assert len(text.encode("utf-8")) < 480 * 1024
    assert re.search(r"politieke_positie|machtsvalentie", text, re.IGNORECASE) is None
    data = json.loads(text)
    assert set(data) == {"meta", "entities", "relations", "sources", "aliases"}
    assert len(data["entities"]) <= pm.DEMO_MAX_ENTITIES
    assert len(data["relations"]) <= pm.DEMO_MAX_RELATIONS
    for relation in data["relations"]:
        assert isinstance(relation["filters"], list)
        assert set(relation["filters"]) <= set(pm.FILTERS)
        assert len(set(relation["filters"])) == len(relation["filters"])
    # every filter is represented around the seeds
    seeds = {entity["id"] for entity in data["entities"]} & set(pm.DEMO_SEEDS)
    around = [rel for rel in data["relations"] if seeds & {rel["source_id"], rel["target_id"]}]
    assert {flt for rel in around for flt in rel["filters"]} == set(pm.FILTERS)
