"""Place list for "Waar speelt het nieuws?" (Epic 14, Story 14.38).

``data/gazetteer/places.json`` comes from GeoNames (``scripts/build_gazetteer.py``); ``extra.yaml``
is a short hand list next to it (names that are never a place, Dutch places that are also words,
names that mean another place, places GeoNames lacks). ``Gazetteer.lookup`` turns a slug into the
places it can mean; choosing between them is the job of ``services/event_places.py``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from backend.app.nlp.entity_keys import slugify

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "gazetteer"

# Kinds of a place
COUNTRY = "country"
CITY = "city"  # a foreign city (capital or 100,000+, Belgian towns from 15,000)
REGION = "region"  # a province, state or other first-level region
PLACE = "place"  # a Dutch town or village
MUNICIPALITY = "municipality"  # a Dutch municipality (only when no town has the name)

_KINDS = {"C": CITY, "R": REGION, "P": PLACE, "M": MUNICIPALITY}


@dataclass(frozen=True, slots=True)
class Place:
    """One place a name can mean."""

    key: str  # place:<geonameid>, place:x-<id> (hand list) or country:<iso>
    name: str  # Dutch display name
    iso_code: str  # country of the place (NL for the Netherlands)
    lat: float | None
    lon: float | None
    population: int
    kind: str
    region: str | None = None  # province or state
    capital: bool = False

    @property
    def is_dutch(self) -> bool:
        return self.iso_code == "NL" and self.kind != COUNTRY


class Gazetteer:
    """Slug -> places, plus the hand rules of ``extra.yaml``."""

    def __init__(self, data: dict[str, Any], extra: dict[str, Any] | None = None) -> None:
        extra = extra or {}
        self._places: list[Place] = [
            Place(
                key=f"place:{row[0]}",
                name=row[1],
                iso_code=row[2],
                lat=row[3],
                lon=row[4],
                population=int(row[5] or 0),
                kind=_KINDS[row[6][0]],
                region=row[7],
                capital=row[6].endswith("*"),
            )
            for row in data.get("places", [])
        ]
        self._by_id = {place.key: place for place in self._places}
        self.countries: dict[str, Place] = {
            iso: Place(
                key=f"country:{iso.lower()}",
                name=info["name"],
                iso_code=iso,
                lat=info.get("lat"),
                lon=info.get("lon"),
                population=0,
                kind=COUNTRY,
            )
            for iso, info in data.get("countries", {}).items()
        }
        self._names: dict[str, list[Place]] = {}
        for slug, refs in data.get("names", {}).items():
            self._names[slug] = [place for ref in refs if (place := self._resolve(ref))]

        self.never: frozenset[str] = frozenset(slugify(s) for s in extra.get("never") or [])
        self.needs_preposition: frozenset[str] = frozenset(
            slugify(s) for s in extra.get("needs_preposition") or []
        )
        for item in extra.get("places") or []:
            place = Place(
                key=f"place:x-{item['id']}",
                name=item["name"],
                iso_code=item["cc"],
                lat=float(item["lat"]),
                lon=float(item["lon"]),
                population=int(item.get("population", 0)),
                kind=item.get("kind", CITY),
                region=item.get("region"),
            )
            self._by_id[place.key] = place
            for name in item.get("names") or [item["name"]]:
                self._names[slugify(name)] = [place]
        for slug, ref in (extra.get("aliases") or {}).items():
            place = self._resolve(ref)
            if place is not None:
                self._names[slugify(slug)] = [place]
        for slug, ref in (extra.get("also") or {}).items():
            place = self._resolve(ref)
            current = self._names.setdefault(slugify(slug), [])
            if place is not None and place not in current:
                current.append(place)
        self.max_words = max((slug.count("-") + 1 for slug in self._names), default=1)

    def _resolve(self, ref: Any) -> Place | None:
        if isinstance(ref, int):
            return self._places[ref] if 0 <= ref < len(self._places) else None
        if isinstance(ref, str):
            if ref.startswith("c:"):
                return self.countries.get(ref[2:].upper())
            if ref.startswith("g:"):
                return self._by_id.get(f"place:{ref[2:]}")
        return None

    def lookup(self, slug: str) -> list[Place]:
        """Every place ``slug`` can mean (empty for names that are never a place)."""

        if not slug or slug in self.never:
            return []
        places = list(self._names.get(slug, ()))
        # "gemeente Amsterdam" is Amsterdam: the town wins from its municipality (_choose)
        if slug.startswith("gemeente-") and len(slug) > len("gemeente-"):
            places += [p for p in self.lookup(slug[len("gemeente-") :]) if p not in places]
        return places

    def __contains__(self, slug: str) -> bool:
        return bool(self.lookup(slug))

    def country(self, iso_code: str) -> Place | None:
        return self.countries.get(iso_code.upper())


@lru_cache(maxsize=1)
def get_gazetteer() -> Gazetteer:
    """The place list of the app (loaded once, ~1 MB)."""

    data = json.loads((DATA_DIR / "places.json").read_text(encoding="utf-8"))
    extra_path = DATA_DIR / "extra.yaml"
    extra = yaml.safe_load(extra_path.read_text(encoding="utf-8")) if extra_path.exists() else {}
    return Gazetteer(data, extra)


__all__ = [
    "CITY",
    "COUNTRY",
    "MUNICIPALITY",
    "PLACE",
    "REGION",
    "Gazetteer",
    "Place",
    "get_gazetteer",
]
