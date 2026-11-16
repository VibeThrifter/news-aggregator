#!/usr/bin/env python3
"""Build the place list for "Waar speelt het nieuws?" (Story 14.38) from GeoNames.

Writes ``backend/app/data/gazetteer/places.json`` (in git). The downloads stay outside the repo.

What goes in:
- the Netherlands: populated places (class P), municipalities (ADM2) and provinces (ADM1);
- abroad: countries, cities of at least 100,000 people and capitals, Belgian towns of at least
  15,000, and the regions (ADM1) of the countries the Dutch news writes about by region;
- names: the GeoNames name, its ASCII form and the Dutch names (language ``nl``). Not the names in
  every language: those gave Porto -> Bordeaux and Playa -> Oranjestad. Countries get only their
  Dutch names and the aliases the app already knows (``CountryIndex``): English country names are
  mostly people in Dutch text (Jordan, Chad).

Source: GeoNames (https://www.geonames.org), CC BY 4.0. Usage::

    python3.11 scripts/build_gazetteer.py --download-dir /tmp/geonames   # downloads what is missing
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.nlp.entity_keys import get_country_index, slugify  # noqa: E402

BASE_URL = "https://download.geonames.org/export/dump/"
FILES = (
    "countryInfo.txt",
    "admin1CodesASCII.txt",
    "NL.zip",
    "cities15000.zip",
    "alternateNamesV2.zip",
)
OUT = ROOT / "backend" / "app" / "data" / "gazetteer" / "places.json"

# Foreign cities: at least this many people (capitals always)
WORLD_CITY_MIN_POP = 100_000
# Countries whose towns from 15,000 people are in (Belgian news is Dutch-language news)
SMALL_TOWN_COUNTRIES = {"BE"}
# Countries whose regions (ADM1) are in: Dutch news names Texas, Sicilië, Catalonië, Beieren.
# Not every country: regions called "Nord" or "Centre" would match words that are no region.
REGION_COUNTRIES = {
    "US",
    "CA",
    "AU",
    "DE",
    "ES",
    "IT",
    "FR",
    "GB",
    "BE",
    "UA",
    "RU",
    "CN",
    "IN",
    "BR",
    "MX",
}
NL_PLACE_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG", "PPLS", "PPLX"}
WORLD_CITY_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG", "PPLX"}
# Names of fewer letters are never matched
MIN_SLUG = 3
# Country abbreviations that count
ABBREVIATIONS = {"vs", "vk", "vae", "usa", "drc"}


def _is_adjective(slug: str, country: dict) -> bool:
    """ "Amerikaanse", "Frans", "Belgisch", "Australian": an adjective is no place in a headline.

    The CountryIndex aliases share a prefix with the country name, so they include adjectives.
    A Dutch name of the country itself (Cyprus, Honduras) is kept.
    """

    if "-" in slug:
        return False
    if slug in {slugify(name) for name in country["names"]} | {slugify(country["name"])}:
        return False
    return slug.endswith(("se", "sche", "isch", "ees", "aans", "iens", "an", "s"))


def download(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = directory / name
        if target.exists() and target.stat().st_size > 0:
            continue
        print(f"downloading {name} ...", flush=True)
        urllib.request.urlretrieve(BASE_URL + name, target)  # noqa: S310 - fixed https URL


def _rows(path: Path, member: str | None = None):
    if member:
        with zipfile.ZipFile(path) as archive:
            with archive.open(member) as handle:
                for line in io.TextIOWrapper(handle, encoding="utf-8"):
                    if line and not line.startswith("#"):
                        yield line.rstrip("\n").split("\t")
    else:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line and not line.startswith("#"):
                    yield line.rstrip("\n").split("\t")


def build(directory: Path) -> dict:
    # Places: geonameid -> record
    places: dict[int, dict] = {}
    admin1_ids: dict[str, int] = {}  # "NL.11" -> geonameid
    admin1_names: dict[str, str] = {}

    for row in _rows(directory / "admin1CodesASCII.txt"):
        code, name, _ascii, gid = row[0], row[1], row[2], int(row[3])
        admin1_ids[code] = gid
        admin1_names[code] = name
        country = code.split(".")[0]
        if country == "NL" or country in REGION_COUNTRIES:
            places[gid] = {
                "id": gid,
                "name": name,
                "names": {name, row[2]},
                "cc": country,
                "lat": None,
                "lon": None,
                "pop": 0,
                "kind": "R",
                "admin1": code,
            }

    # The Netherlands
    for row in _rows(directory / "NL.zip", "NL.txt"):
        gid, fclass, fcode = int(row[0]), row[6], row[7]
        if fclass == "P" and fcode in NL_PLACE_CODES:
            kind = "P"
        elif fclass == "A" and fcode == "ADM2":
            kind = "M"
        elif fclass == "A" and fcode == "ADM1":
            kind = "R"
        else:
            continue
        record = places.get(gid) or {"id": gid, "names": set()}
        record.update(
            name=row[1],
            cc="NL",
            lat=round(float(row[4]), 4),
            lon=round(float(row[5]), 4),
            pop=int(row[14] or 0),
            kind=kind,
            admin1=f"NL.{row[10]}" if row[10] else None,
        )
        record["names"] |= {row[1], row[2]}
        places[gid] = record

    # Abroad (cities15000 also has the coordinates of the regions' seats; regions get theirs below)
    capitals: dict[str, tuple[float, float]] = {}
    # Seat of every region: its biggest town of 15,000+ (also when that town itself stays out)
    seats: dict[str, tuple[int, float, float]] = {}
    for row in _rows(directory / "cities15000.zip", "cities15000.txt"):
        gid, fcode, cc, pop = int(row[0]), row[7], row[8], int(row[14] or 0)
        if row[10]:
            code = f"{cc}.{row[10]}"
            if code not in seats or pop > seats[code][0]:
                seats[code] = (pop, round(float(row[4]), 4), round(float(row[5]), 4))
        if cc == "NL":
            continue
        if fcode == "PPLC":
            capitals[cc] = (round(float(row[4]), 4), round(float(row[5]), 4))
        keep = fcode == "PPLC" or (fcode in WORLD_CITY_CODES and pop >= WORLD_CITY_MIN_POP)
        keep = keep or (cc in SMALL_TOWN_COUNTRIES and fcode in WORLD_CITY_CODES)
        if not keep:
            continue
        places[gid] = {
            "id": gid,
            "name": row[1],
            "names": {row[1], row[2]},
            "cc": cc,
            "lat": round(float(row[4]), 4),
            "lon": round(float(row[5]), 4),
            "pop": pop,
            "kind": "C",
            "admin1": f"{cc}.{row[10]}" if row[10] else None,
            "capital": fcode == "PPLC",
        }

    # Countries
    countries: dict[str, dict] = {}
    country_gid: dict[int, str] = {}
    for row in _rows(directory / "countryInfo.txt"):
        iso, name, gid = row[0], row[4], int(row[16] or 0)
        lat, lon = capitals.get(iso, (None, None))
        countries[iso] = {"name": name, "lat": lat, "lon": lon, "names": set(), "gid": gid}
        if gid:
            country_gid[gid] = iso

    # Dutch names (one pass over the 780 MB file)
    wanted = set(places) | set(country_gid)
    preferred: dict[int, str] = {}
    dutch: dict[int, list[str]] = defaultdict(list)
    for row in _rows(directory / "alternateNamesV2.zip", "alternateNamesV2.txt"):
        if len(row) < 8 or row[2] != "nl":
            continue
        gid = int(row[1])
        if gid not in wanted or row[7] == "1":  # historic names stay out
            continue
        dutch[gid].append(row[3])
        if row[4] == "1":
            preferred[gid] = row[3]

    for gid, record in places.items():
        record["names"] |= set(dutch.get(gid, ()))
        if gid in preferred:
            record["name"] = preferred[gid]
        elif record["cc"] != "NL" and dutch.get(gid):
            record["name"] = dutch[gid][0]
    for gid, iso in country_gid.items():
        countries[iso]["names"] |= set(dutch.get(gid, ()))
        if gid in preferred:
            countries[iso]["name"] = preferred[gid]
        elif dutch.get(gid):
            countries[iso]["name"] = dutch[gid][0]

    # Country aliases the app already knows (Dutch names, VS, VK, ...)
    index = get_country_index()
    for slug, match in index._entries.items():  # noqa: SLF001 - same package, read only
        if match.iso_code in countries and not _is_adjective(slug, countries[match.iso_code]):
            countries[match.iso_code]["names"].add(slug)

    # Regions: coordinates of their seat (the biggest place we have in them)
    best: dict[str, dict] = {}
    for record in places.values():
        if record["kind"] in ("P", "C", "M") and record.get("admin1") and record["lat"] is not None:
            current = best.get(record["admin1"])
            if current is None or record["pop"] > current["pop"]:
                best[record["admin1"]] = record
    for record in places.values():
        if record["kind"] == "R" and record["lat"] is None:
            seat = best.get(record["admin1"])
            if seat is not None:
                record["lat"], record["lon"] = seat["lat"], seat["lon"]
            elif record["admin1"] in seats:
                _pop, record["lat"], record["lon"] = seats[record["admin1"]]
    places = {gid: record for gid, record in places.items() if record["lat"] is not None}

    # Region names for display (Dutch province names)
    def region_name(code: str | None) -> str | None:
        if not code:
            return None
        gid = admin1_ids.get(code)
        if gid is not None and gid in places:
            return places[gid]["name"]
        return admin1_names.get(code)

    # Output
    out_places = []
    names: dict[str, list] = defaultdict(list)
    for gid in sorted(places):
        record = places[gid]
        position = len(out_places)
        display = record["name"]
        if record["kind"] == "M" and display.startswith("Gemeente "):
            display = display[len("Gemeente ") :]
        out_places.append(
            [
                gid,
                display,
                record["cc"],
                record["lat"],
                record["lon"],
                record["pop"],
                record["kind"] + ("*" if record.get("capital") else ""),
                region_name(record.get("admin1")) if record["kind"] != "R" else None,
            ]
        )
        for name in record["names"]:
            slug = slugify(name)
            if len(slug) >= MIN_SLUG and position not in names[slug]:
                names[slug].append(position)
    out_countries = {}
    for iso in sorted(countries):
        country = countries[iso]
        display = re.sub(r"\s*\(.*\)$", "", country["name"])  # "Iran (Islamitische Republiek)"
        out_countries[iso] = {"name": display, "lat": country["lat"], "lon": country["lon"]}
        for name in country["names"] | {country["name"]}:
            slug = slugify(name)
            # Short names only as the app's abbreviations (VS, VK, VAE); "Man" is no Isle of Man
            short_ok = slug in ABBREVIATIONS
            if (len(slug) > 3 or short_ok) and f"c:{iso}" not in names[slug]:
                names[slug].append(f"c:{iso}")
    return {
        "source": f"GeoNames (geonames.org, CC BY 4.0), {date.today().isoformat()}",
        "places": out_places,
        "countries": out_countries,
        "names": dict(sorted(names.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--download-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    download(args.download_dir)
    data = build(args.download_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    kinds = defaultdict(int)
    for place in data["places"]:
        kinds[(place[2] == "NL", place[6][0])] += 1
    print(
        f"wrote {args.out}: {len(data['places'])} places {dict(kinds)}, "
        f"{len(data['countries'])} countries, "
        f"{len(data['names'])} names, {args.out.stat().st_size // 1024} KB"
    )


if __name__ == "__main__":
    main()
