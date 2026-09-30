"""Canonical entity keys shared between backend and frontend (Epic 11, Story 11.8).

The frontend implements the exact same ``slugify`` in TypeScript; both implementations are
verified against the shared vectors in ``backend/tests/fixtures/entity_keys.json``. Any change
to :func:`slugify` MUST be mirrored in the frontend and in that fixture file.

Entity keys have the form ``"{kind}:{slug}"`` (e.g. ``person:mark-rutte``) and, for countries,
``"country:{iso}"`` with a lowercase ISO 3166-1 alpha-2 code (e.g. ``country:il``).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.app.services.country_detector import CountryMapping

# Kinds allowed by the ``ck_event_entities_kind`` CHECK constraint.
ENTITY_KINDS: frozenset[str] = frozenset({"person", "org", "place", "country", "group", "event"})

# spaCy label -> entity kind. Every other label (DATE, CARDINAL, MONEY, ...) is dropped.
LABEL_TO_KIND: dict[str, str] = {
    "PERSON": "person",
    "ORG": "org",
    "GPE": "place",
    "LOC": "place",
    "NORP": "group",
}

# Relative importance of each kind when scoring related events.
KIND_WEIGHTS: dict[str, float] = {
    "person": 1.0,
    "org": 0.8,
    "event": 0.6,
    "place": 0.5,
    "group": 0.4,
    "country": 0.3,
}

# Leading articles dropped by slugify when the name has more than one token.
_LEADING_ARTICLES: frozenset[str] = frozenset({"de", "het", "een", "the"})

# Characters that do not decompose under NFKD and need explicit transliteration.
_TRANSLITERATIONS: dict[str, str] = {
    "ł": "l",
    "ø": "o",
    "æ": "ae",
    "œ": "oe",
    "ß": "ss",
    "đ": "d",
    "ı": "i",
    "þ": "th",
    "ð": "d",
}
_TRANSLIT_TABLE = str.maketrans(_TRANSLITERATIONS)
_APOSTROPHES_TABLE = str.maketrans({"'": None, "’": None, "‘": None, "`": None})
_NON_ALNUM = re.compile(r"[^a-z0-9]")

# Media outlets are reported *by*, not *about*: drop them as entities.
OUTLET_STOPLIST: tuple[str, ...] = (
    "NOS",
    "NU.nl",
    "NU",
    "AD",
    "Algemeen Dagblad",
    "RTL",
    "RTL Nieuws",
    "Telegraaf",
    "De Telegraaf",
    "Volkskrant",
    "de Volkskrant",
    "Trouw",
    "Parool",
    "Het Parool",
    "GeenStijl",
    "ANP",
    "NPO",
    "NineForNews",
    "Nine For News",
    "NieuwRechts",
    "Nieuw Rechts",
    "De Andere Krant",
    "Een Blik op de NOS",
    "X",
    "Twitter",
    # News agencies are sources, not subjects (like ANP above).
    "Reuters",
    "AFP",
    "Associated Press",
    "Belga",
)


def slugify(name: str | None) -> str:
    """Return the canonical slug for an entity name.

    Steps (identical in the TypeScript implementation):
    1. NFKD normalise and drop combining marks (Unicode category ``Mn``)
    2. lowercase
    3. transliterate ł ø æ œ ß đ ı þ ð
    4. remove apostrophes (' ’ ‘ `)
    5. replace every character outside ``[a-z0-9]`` by a space
    6. split on whitespace
    7. drop a leading de/het/een/the when more than one token remains
    8. join the tokens with ``-``
    """

    if not name:
        return ""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    lowered = stripped.lower().translate(_TRANSLIT_TABLE).translate(_APOSTROPHES_TABLE)
    tokens = _NON_ALNUM.sub(" ", lowered).split()
    if len(tokens) > 1 and tokens[0] in _LEADING_ARTICLES:
        tokens = tokens[1:]
    return "-".join(tokens)


def entity_key(kind: str, slug_or_iso: str) -> str:
    """Build the canonical entity key (``country:{iso}`` is lowercased)."""

    if kind == "country":
        return f"country:{slug_or_iso.lower()}"
    return f"{kind}:{slug_or_iso}"


def split_entity_key(key: str) -> tuple[str, str]:
    """Split an entity key into ``(kind, value)``."""

    kind, _, value = key.partition(":")
    return kind, value


def kind_for_label(label: str | None) -> str | None:
    """Map a spaCy label to an entity kind (``None`` means: drop the mention)."""

    if not label:
        return None
    return LABEL_TO_KIND.get(label.upper())


def kind_weight(kind: str) -> float:
    """Return the relative importance of an entity kind (0 for unknown kinds)."""

    return KIND_WEIGHTS.get(kind, 0.0)


OUTLET_SLUGS: frozenset[str] = frozenset(slugify(name) for name in OUTLET_STOPLIST)


def is_outlet(name_or_slug: str | None) -> bool:
    """Return True when the name (or slug) refers to a media outlet on the stoplist."""

    if not name_or_slug:
        return False
    return slugify(name_or_slug) in OUTLET_SLUGS


# --------------------------------------------------------------------------------------
# Country lookup (GPE/LOC only)
# --------------------------------------------------------------------------------------

# Words that mark a multi-word alias as a country-level name ("verenigde staten").
_STATE_WORDS: frozenset[str] = frozenset(
    {
        "verenigde",
        "verenigd",
        "staten",
        "united",
        "states",
        "koninkrijk",
        "kingdom",
        "republiek",
        "republic",
        "emiraten",
        "emirates",
    }
)

# The Netherlands is excluded from the international mapping but is the most frequent GPE.
_EXTRA_COUNTRIES: dict[str, tuple[str, tuple[str, ...]]] = {
    "NL": ("Nederland", ("nederland", "netherlands", "the netherlands", "holland")),
}


@dataclass(frozen=True, slots=True)
class CountryMatch:
    """Resolved country for a place name."""

    iso_code: str
    name: str


class CountryIndex:
    """Slug -> country lookup built from the country mapping YAML.

    Only country-level names are indexed: the country name, its key, and aliases that look like
    a variant of those (shared 4-letter prefix with the name, key or first/Dutch alias), short
    abbreviations (``vs``, ``vk``) and multi-word state names (``verenigde staten``). Aliases that
    are cities, leaders or institutions (``gaza``, ``moskou``, ``trump``, ``kremlin``) are *not*
    mapped, so "Gaza" stays a ``place`` entity instead of collapsing into ``country:ps``.
    """

    def __init__(self, entries: Mapping[str, CountryMatch]) -> None:
        self._entries = dict(entries)

    def __len__(self) -> int:
        return len(self._entries)

    def lookup(self, slug: str) -> CountryMatch | None:
        return self._entries.get(slug)

    def name_for_iso(self, iso_code: str) -> str | None:
        iso = iso_code.upper()
        for match in self._entries.values():
            if match.iso_code == iso:
                return match.name
        return None

    @classmethod
    def from_mapping(cls, mapping: CountryMapping | None) -> CountryIndex:
        entries: dict[str, CountryMatch] = {}

        def add(slug: str, match: CountryMatch) -> None:
            if slug and slug not in entries:
                entries[slug] = match

        countries: Iterable = mapping.countries.items() if mapping is not None else ()
        for key, country in countries:
            iso = (country.iso_code or "").upper()
            if len(iso) != 2:
                continue
            match = CountryMatch(iso_code=iso, name=country.name)
            aliases = list(country.aliases or [])
            anchors = [slugify(country.name), slugify(key.replace("_", " "))]
            if aliases:
                anchors.append(slugify(aliases[0]))
            anchors = [anchor for anchor in anchors if anchor]
            for anchor in anchors:
                add(anchor, match)
            for alias in aliases:
                alias_slug = slugify(alias)
                if _is_country_level_alias(alias_slug, anchors):
                    add(alias_slug, match)

        for iso, (name, names) in _EXTRA_COUNTRIES.items():
            match = CountryMatch(iso_code=iso, name=name)
            for extra in names:
                add(slugify(extra), match)
        return cls(entries)


def _is_country_level_alias(alias_slug: str, anchors: Iterable[str]) -> bool:
    if not alias_slug:
        return False
    tokens = alias_slug.split("-")
    if len(tokens) == 1 and len(alias_slug) <= 3 and alias_slug.isalpha():
        return True  # abbreviations such as "vs", "vk", "vae", "drc"
    if len(tokens) > 1 and any(token in _STATE_WORDS for token in tokens):
        return True
    return any(len(anchor) >= 4 and alias_slug[:4] == anchor[:4] for anchor in anchors)


_COUNTRY_INDEX_CACHE: dict[int, tuple[object, CountryIndex]] = {}


def get_country_index(mapping: CountryMapping | CountryIndex | None = None) -> CountryIndex:
    """Return a (cached) :class:`CountryIndex` for a mapping (default: the YAML mapping)."""

    if isinstance(mapping, CountryIndex):
        return mapping
    if mapping is None:
        from backend.app.services.country_detector import load_country_mapping

        mapping = load_country_mapping()
    cached = _COUNTRY_INDEX_CACHE.get(id(mapping))
    if cached is not None and cached[0] is mapping:
        return cached[1]
    index = CountryIndex.from_mapping(mapping)
    _COUNTRY_INDEX_CACHE[id(mapping)] = (mapping, index)
    return index


__all__ = [
    "ENTITY_KINDS",
    "KIND_WEIGHTS",
    "LABEL_TO_KIND",
    "OUTLET_SLUGS",
    "OUTLET_STOPLIST",
    "CountryIndex",
    "CountryMatch",
    "entity_key",
    "get_country_index",
    "is_outlet",
    "kind_for_label",
    "kind_weight",
    "slugify",
    "split_entity_key",
]
