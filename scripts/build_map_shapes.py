#!/usr/bin/env python3
"""Map shapes for the page /kaart (Story 14.38). Writes ``frontend/lib/kaart/geo/``.

- ``nl-provincies.json``: the provinces of CBS (PDOK "gebiedsindelingen", provincie_gegeneraliseerd,
  CC BY 4.0), simplified (Douglas-Peucker) to a few tens of KB, exterior rings clockwise as d3-geo
  wants them.
- ``world-110m.json``: Natural Earth countries 1:110m via world-atlas (public domain), as is.
- ``iso-numeric.json``: ISO 3166 alpha-2 -> numeric code (the ids of world-110m), from GeoNames.

Usage (downloads in a folder of their own)::

    python3.11 scripts/build_map_shapes.py --download-dir /tmp/kaart-geo \
        --geonames-dir /tmp/geonames   # countryInfo.txt of scripts/build_gazetteer.py
"""

from __future__ import annotations

import argparse
import json
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "lib" / "kaart" / "geo"
PROVINCES_URL = (
    "https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0?request=GetFeature&service=WFS"
    "&version=2.0.0&typeName=gebiedsindelingen:provincie_gegeneraliseerd&outputFormat=json"
    "&srsName=EPSG:4326"
)
WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"
# Degrees: ~300 m, invisible on a phone-sized map of the Netherlands
TOLERANCE = 0.003


def _fetch(url: str, target: Path) -> None:
    if not target.exists() or target.stat().st_size == 0:
        print(f"downloading {target.name} ...", flush=True)
        urllib.request.urlretrieve(url, target)  # noqa: S310 - fixed https URL


def _distance(point, start, end) -> float:
    (x, y), (x1, y1), (x2, y2) = point, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** 0.5


def _simplify(points: list, tolerance: float) -> list:
    """Douglas-Peucker without recursion."""

    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        index, distance = 0, 0.0
        for i in range(first + 1, last):
            d = _distance(points[i], points[first], points[last])
            if d > distance:
                index, distance = i, d
        if distance > tolerance:
            keep[index] = True
            stack.extend(((first, index), (index, last)))
    return [p for p, k in zip(points, keep, strict=True) if k]


def _area(ring: list) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False)) / 2


def _ring(ring: list, exterior: bool) -> list | None:
    simple = [[round(x, 4), round(y, 4)] for x, y in _simplify(ring, TOLERANCE)]
    if len(simple) < 4:
        return None
    # d3-geo: exterior rings clockwise (negative planar area), holes counter-clockwise
    if (_area(simple) > 0) == exterior:
        simple.reverse()
    return simple


def provinces(source: Path) -> dict:
    data = json.loads(source.read_text(encoding="utf-8"))
    features = []
    for feature in data["features"]:
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"]
        )
        out = []
        for polygon in polygons:
            rings = [_ring(ring, exterior=i == 0) for i, ring in enumerate(polygon)]
            if rings and rings[0] is not None:
                out.append([ring for ring in rings if ring is not None])
        features.append(
            {
                "type": "Feature",
                "properties": {"name": feature["properties"]["statnaam"]},
                "geometry": {"type": "MultiPolygon", "coordinates": out},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def iso_numeric(country_info: Path) -> dict[str, str]:
    codes = {}
    for line in country_info.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        row = line.split("\t")
        codes[row[0]] = row[2].zfill(3)
    return dict(sorted(codes.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download-dir", type=Path, required=True)
    parser.add_argument("--geonames-dir", type=Path, required=True)
    args = parser.parse_args()
    args.download_dir.mkdir(parents=True, exist_ok=True)
    _fetch(PROVINCES_URL, args.download_dir / "provincies.json")
    _fetch(WORLD_URL, args.download_dir / "countries-110m.json")
    OUT.mkdir(parents=True, exist_ok=True)
    shapes = provinces(args.download_dir / "provincies.json")
    (OUT / "nl-provincies.json").write_text(
        json.dumps(shapes, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    shutil.copyfile(args.download_dir / "countries-110m.json", OUT / "world-110m.json")
    (OUT / "iso-numeric.json").write_text(
        json.dumps(iso_numeric(args.geonames_dir / "countryInfo.txt"), separators=(",", ":")),
        encoding="utf-8",
    )
    for name in ("nl-provincies.json", "world-110m.json", "iso-numeric.json"):
        print(f"{OUT / name}: {(OUT / name).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
