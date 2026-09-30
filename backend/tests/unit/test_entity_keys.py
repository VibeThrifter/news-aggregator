# ruff: noqa: S101
"""Tests for the canonical entity keys shared with the frontend (Story 11.8)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.nlp.entity_keys import (
    KIND_WEIGHTS,
    OUTLET_SLUGS,
    CountryIndex,
    entity_key,
    get_country_index,
    is_outlet,
    kind_for_label,
    kind_weight,
    slugify,
    split_entity_key,
)
from backend.app.services.country_detector import (
    Country,
    CountryMapping,
    GoogleNewsParams,
)

VECTORS_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "entity_keys.json"
VECTORS = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))["slugify"]


def test_shared_vectors_file_has_enough_cases() -> None:
    assert len(VECTORS) >= 20
    inputs = {case["input"] for case in VECTORS}
    for required in ("Mark Rutte", "De Nederlandsche Bank", "The Hague", "de", "Straße", ""):
        assert required in inputs


@pytest.mark.parametrize("case", VECTORS, ids=[repr(case["input"]) for case in VECTORS])
def test_slugify_matches_shared_vectors(case: dict[str, str]) -> None:
    assert slugify(case["input"]) == case["expected"]


def test_slugify_handles_none() -> None:
    assert slugify(None) == ""


def test_entity_key_formats() -> None:
    assert entity_key("person", "mark-rutte") == "person:mark-rutte"
    assert entity_key("country", "IL") == "country:il"
    assert split_entity_key("person:mark-rutte") == ("person", "mark-rutte")
    assert split_entity_key("country:il") == ("country", "il")


@pytest.mark.parametrize(
    ("label", "kind"),
    [
        ("PERSON", "person"),
        ("ORG", "org"),
        ("GPE", "place"),
        ("LOC", "place"),
        ("NORP", "group"),
        ("gpe", "place"),
        ("DATE", None),
        ("CARDINAL", None),
        ("EVENT", None),
        ("", None),
        (None, None),
    ],
)
def test_kind_for_label(label: str | None, kind: str | None) -> None:
    assert kind_for_label(label) == kind


def test_kind_weights() -> None:
    assert kind_weight("person") == 1.0
    assert kind_weight("org") == 0.8
    assert kind_weight("place") == 0.5
    assert kind_weight("group") == 0.4
    assert kind_weight("country") == 0.3
    assert kind_weight("unknown") == 0.0
    assert set(KIND_WEIGHTS) >= {"person", "org", "place", "group", "country"}


@pytest.mark.parametrize(
    "name",
    ["NOS", "NU.nl", "de Volkskrant", "Het Parool", "De Telegraaf", "Een Blik op de NOS", "X"],
)
def test_outlets_are_recognised(name: str) -> None:
    assert is_outlet(name)
    assert slugify(name) in OUTLET_SLUGS


@pytest.mark.parametrize("name", ["Mark Rutte", "RIVM", "", None])
def test_non_outlets(name: str | None) -> None:
    assert not is_outlet(name)


def _country(key: str, name: str, iso: str, aliases: list[str]) -> Country:
    return Country(
        key=key,
        name=name,
        iso_code=iso,
        google_news_primary=GoogleNewsParams(gl=iso, hl="en", ceid=f"{iso}:en"),
        aliases=aliases,
    )


@pytest.fixture()
def small_mapping() -> CountryMapping:
    countries = {
        "israel": _country("israel", "Israel", "IL", ["israël", "israeli", "jerusalem", "idf"]),
        "united_states": _country(
            "united_states",
            "United States",
            "US",
            ["amerika", "amerikaanse", "vs", "verenigde staten", "washington", "trump"],
        ),
        "broken": _country("broken", "Broken", "XYZ", ["broken"]),
    }
    return CountryMapping(
        countries=countries,
        excluded_countries=["NL"],
        iso_to_country={c.iso_code: c for c in countries.values()},
    )


def test_country_index_maps_only_country_level_names(small_mapping: CountryMapping) -> None:
    index = CountryIndex.from_mapping(small_mapping)
    assert index.lookup("israel").iso_code == "IL"
    assert index.lookup("israeli").iso_code == "IL"  # shares prefix with the name
    assert index.lookup("vs").iso_code == "US"  # short abbreviation
    assert index.lookup("verenigde-staten").iso_code == "US"  # state word
    assert index.lookup("united-states").iso_code == "US"  # key / name
    assert index.lookup("amerika").iso_code == "US"  # first (Dutch) alias
    # cities, leaders and institutions stay places/persons
    assert index.lookup("jerusalem") is None
    assert index.lookup("washington") is None
    assert index.lookup("trump") is None
    # invalid ISO codes are ignored, the Netherlands is always known
    assert index.lookup("broken") is None
    assert index.lookup("nederland").iso_code == "NL"
    assert index.name_for_iso("il") == "Israel"
    assert index.name_for_iso("zz") is None
    assert len(index) > 5


def test_get_country_index_caches_and_passes_through(small_mapping: CountryMapping) -> None:
    first = get_country_index(small_mapping)
    assert get_country_index(small_mapping) is first
    assert get_country_index(first) is first


def test_get_country_index_defaults_to_yaml_mapping() -> None:
    index = get_country_index()
    assert index.lookup("israel").iso_code == "IL"
    assert index.lookup("oekraine").iso_code == "UA"
    assert index.lookup("gaza") is None
    assert index.lookup("moskou") is None
    assert CountryIndex.from_mapping(None).lookup("nederland").iso_code == "NL"
