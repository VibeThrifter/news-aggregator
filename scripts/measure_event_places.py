#!/usr/bin/env python3
"""Measure "Waar speelt het nieuws?" (Story 14.38) on the local database. Reads only.

    PYTHONPATH=. .venv/bin/python scripts/measure_event_places.py --days 45 --sample out.json

Prints how many news items get a Dutch place, a foreign place, both or none, the most frequent
places, and writes a stratified sample for blind judging: per item the analysis title, the start
of two Dutch articles and the proposed place, never the rule or why it was chosen. Items without a
place are in the sample too (did the rule miss an obvious place?).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402

from backend.app.db.models import Event  # noqa: E402
from backend.app.db.session import get_sessionmaker  # noqa: E402
from backend.app.services.event_places import (  # noqa: E402
    LEAD_CHARS,
    EventPlacesService,
    places_for_event,
)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=45)
    parser.add_argument("--sample", type=Path)
    parser.add_argument("--per-group", type=int, default=100)
    parser.add_argument("--none", type=int, default=50)
    parser.add_argument("--seed", type=int, default=14_38)
    parser.add_argument(
        "--exclude", type=Path, help="earlier sample (json): its news items are left out"
    )
    args = parser.parse_args()

    service = EventPlacesService()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    async with get_sessionmaker()() as session:
        ids = (
            (await session.execute(select(Event.id).where(Event.first_seen_at >= since)))
            .scalars()
            .all()
        )

    results = {}
    for start in range(0, len(ids), 200):
        inputs = await service.load_inputs(ids[start : start + 200])
        for event_id, source in inputs.items():
            if not source.title or not source.articles:
                continue
            results[event_id] = (
                source,
                places_for_event(
                    source.articles, event_type=source.event_type, gazetteer=service.gazetteer
                ),
            )

    groups: dict[str, list[int]] = defaultdict(list)
    dutch, foreign = Counter(), Counter()
    for event_id, (_source, found) in results.items():
        has_nl = any(f.place.iso_code == "NL" for f in found)
        has_abroad = any(f.place.iso_code != "NL" for f in found)
        if has_nl:
            groups["nl"].append(event_id)
        if has_abroad:
            groups["abroad"].append(event_id)
        if not found:
            groups["none"].append(event_id)
        for f in found:
            (dutch if f.place.iso_code == "NL" else foreign)[
                f"{f.place.name} ({f.place.iso_code}, {f.place.kind})"
            ] += 1

    total = len(results)

    def share(n: int) -> str:
        return f"{n} ({n / total:.0%})" if total else "0"

    both = len(set(groups["nl"]) & set(groups["abroad"]))
    print(f"news items with an analysis title: {total}")
    print(
        f"  Dutch place: {share(len(groups['nl']))}  abroad: {share(len(groups['abroad']))}  "
        f"both: {both}  none: {share(len(groups['none']))}"
    )
    print("  top Dutch:", dutch.most_common(25))
    print("  top abroad:", foreign.most_common(40))
    by_type = Counter(results[i][0].event_type or "-" for i in results)
    with_place = Counter(results[i][0].event_type or "-" for i in results if results[i][1])
    print(
        "  share with a place per category:",
        {k: f"{with_place[k]}/{v}" for k, v in by_type.most_common()},
    )

    if not args.sample:
        return
    rnd = random.Random(args.seed)  # noqa: S311 - a reproducible sample, no secret
    items = []
    excluded: set[int] = set()
    if args.exclude:
        excluded = {
            int(item["id"].split("-")[1])
            for item in json.loads(args.exclude.read_text(encoding="utf-8"))
        }
    for group, size in (("nl", args.per_group), ("abroad", args.per_group), ("none", args.none)):
        pool = sorted(set(groups[group]) - excluded)
        rnd.shuffle(pool)
        # Spread over the categories: round robin per event type
        per_type: dict[str, list[int]] = defaultdict(list)
        for event_id in pool:
            per_type[results[event_id][0].event_type or "-"].append(event_id)
        picked: list[int] = []
        while len(picked) < size and any(per_type.values()):
            for kind in sorted(per_type):
                if per_type[kind] and len(picked) < size:
                    picked.append(per_type[kind].pop())
        for event_id in picked:
            source, found = results[event_id]
            leads = []
            for article in source.articles[:2]:
                leads.append(
                    {
                        "kop": article.title,
                        "begin": (article.lead or "")[:LEAD_CHARS],
                    }
                )
            places = (
                [f for f in found if (f.place.iso_code == "NL") == (group == "nl")]
                if group != "none"
                else []
            )
            items.append(
                {
                    "id": f"{group}-{event_id}",
                    "titel": source.title,
                    "artikelen": leads,
                    "plek": [
                        f"{f.place.name}"
                        + (f", {f.place.region}" if f.place.region else "")
                        + f" ({f.place.iso_code})"
                        for f in places
                    ],
                    "categorie": source.event_type,
                }
            )
    rnd.shuffle(items)
    args.sample.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(items)} items to {args.sample}")


if __name__ == "__main__":
    asyncio.run(main())
