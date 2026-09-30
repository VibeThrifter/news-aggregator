#!/usr/bin/env python3
"""Export a small propaganda-model slice for the demo event (Epic 11, Story 11.17).

The Vercel demo runs without Supabase, so it bundles ``frontend/lib/explore/fixtures/demo-pm.json``:
the outlets of the fictional demo event (NOS, NU.nl, AD, De Telegraaf, de Volkskrant, GeenStijl,
De Andere Krant) plus DPG Media and Mediahuis, their 1-hop neighbours and - for owners - one more
hop along eigendom/financiering edges. Every filter is represented around every seed: per seed and
per filter the first 6 relations of the filtered neighbourhood are selected first (caps: ~200
entities, ~480 relations, < 480 KB). Relations carry ``filter`` (primary, edge colour) and
``filters`` (primary filter + all filter tags of the mechanism).

Uses the SAME reader + transformer as the Supabase sync
(``backend/app/services/propaganda_model_sync.py``): approved rows only, no political-position
layer, no machtsvalentie (verified mechanically before writing), certainty only as a label.
The propaganda-model database is opened strictly read-only.

Usage:
    PYTHONPATH=. .venv/bin/python scripts/export_pm_demo_slice.py
    PYTHONPATH=. .venv/bin/python scripts/export_pm_demo_slice.py \\
        --db ../propaganda-model/data/propaganda_model.db \\
        --out frontend/lib/explore/fixtures/demo-pm.json --max-entities 200 --max-relations 480
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.core.config import DEFAULT_PROPAGANDA_DB_PATH  # noqa: E402
from backend.app.nlp.entity_keys import slugify  # noqa: E402
from backend.app.services.propaganda_model_sync import (  # noqa: E402
    DEMO_MAX_ENTITIES,
    DEMO_MAX_RELATIONS,
    DEMO_PER_FILTER,
    DEMO_SEEDS,
    assert_no_excluded_layers,
    build_demo_slice,
    dump_demo_slice,
    load_snapshot,
)

DEFAULT_OUT = ROOT / "frontend" / "lib" / "explore" / "fixtures" / "demo-pm.json"
MAX_BYTES = 480 * 1024


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db", type=Path, default=DEFAULT_PROPAGANDA_DB_PATH)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--max-entities", type=int, default=DEMO_MAX_ENTITIES)
    parser.add_argument("--max-relations", type=int, default=DEMO_MAX_RELATIONS)
    parser.add_argument(
        "--per-filter", type=int, default=DEMO_PER_FILTER, help="per seed and per filter"
    )
    parser.add_argument("--max-sources", type=int, default=12, help="per entity/relation")
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    snapshot = load_snapshot(args.db)

    names = {entity["id"]: entity["name"] for entity in snapshot.entities}
    seeds: list[int] = []
    for seed_id, expected in DEMO_SEEDS.items():
        actual = names.get(seed_id)
        if actual is None or slugify(actual) != slugify(expected):
            print(f"WARNING: seed {seed_id} ({expected}) missing or renamed ({actual!r}); skipped")
            continue
        seeds.append(seed_id)

    max_sources = args.max_sources
    while True:
        slice_data = build_demo_slice(
            snapshot,
            seeds,
            max_entities=args.max_entities,
            max_relations=args.max_relations,
            max_sources_per_owner=max_sources,
            per_filter=args.per_filter,
        )
        payload = dump_demo_slice(slice_data)
        size = len(payload.encode("utf-8"))
        if size <= args.max_bytes or max_sources <= 1:
            break
        max_sources -= 1  # shrink the bundled source lists until the file fits

    assert_no_excluded_layers(payload)
    if size > args.max_bytes:
        print(f"ERROR: slice is {size} bytes (> {args.max_bytes}); lower the caps")
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(payload, encoding="utf-8")
    source_rows = sum(len(rows) for rows in slice_data["sources"].values())
    print(
        f"Wrote {args.out} ({size / 1024:.1f} KB): {len(slice_data['entities'])} entities, "
        f"{len(slice_data['relations'])} relations, {source_rows} sources "
        f"({len(slice_data['sources'])} owners, max {max_sources} each), "
        f"{len(slice_data['aliases'])} aliases; version {slice_data['meta']['version']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
