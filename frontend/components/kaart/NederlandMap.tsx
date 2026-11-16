"use client";

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";

import type { Spot } from "@/lib/kaart/data";

type Provinces = FeatureCollection<MultiPolygon, { name: string }>;

const WIDTH = 520;
const HEIGHT = 600;
/** Names next to the biggest bubbles only: more makes the map unreadable on a phone */
const LABELS = 6;

let provincesCache: Provinces | null = null;

function useProvinces(): Provinces | null {
  const [provinces, setProvinces] = useState<Provinces | null>(provincesCache);
  useEffect(() => {
    if (provincesCache) return;
    let alive = true;
    import("@/lib/kaart/geo/nl-provincies.json").then((module) => {
      provincesCache = (module.default ?? module) as unknown as Provinces;
      if (alive) setProvinces(provincesCache);
    });
    return () => {
      alive = false;
    };
  }, []);
  return provinces;
}

function radius(count: number): number {
  return 5 + 4.5 * Math.sqrt(count);
}

/**
 * The Netherlands with a bubble per place (area after the number of news items) and the provinces
 * the news names as a whole tinted. A tap selects a place.
 */
export function NederlandMap({
  spots,
  selected,
  onSelect,
}: {
  spots: Spot[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const provinces = useProvinces();

  const projection = useMemo(() => {
    if (!provinces) return null;
    return geoMercator().fitExtent(
      [
        [12, 12],
        [WIDTH - 12, HEIGHT - 12],
      ],
      provinces,
    );
  }, [provinces]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const regionCounts = useMemo(() => {
    const counts = new Map<string, Spot>();
    for (const spot of spots) if (spot.kind === "region") counts.set(spot.name.toLowerCase(), spot);
    return counts;
  }, [spots]);

  // Bubbles: biggest first so the small ones stay on top and tappable
  const bubbles = useMemo(() => {
    if (!projection) return [];
    return spots
      .filter((spot) => spot.kind !== "region" && spot.lat !== null && spot.lon !== null)
      .map((spot) => {
        const point = projection([spot.lon as number, spot.lat as number]);
        return point ? { spot, x: point[0], y: point[1], r: radius(spot.items.length) } : null;
      })
      .filter((bubble): bubble is { spot: Spot; x: number; y: number; r: number } => bubble !== null)
      .sort((a, b) => b.r - a.r);
  }, [projection, spots]);

  const labelled = useMemo(() => new Set(bubbles.slice(0, LABELS).map((bubble) => bubble.spot.key)), [bubbles]);

  if (!provinces || !path) {
    return <div className="aspect-[52/60] w-full animate-pulse rounded-2xl bg-paper-200" aria-hidden="true" />;
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full select-none"
      role="img"
      aria-label="Kaart van Nederland met de plaatsen waar het nieuws speelt"
    >
      <g>
        {provinces.features.map((feature: Feature<MultiPolygon, { name: string }>) => {
          const region = regionCounts.get(feature.properties.name.toLowerCase());
          const active = region && region.key === selected;
          return (
            <path
              key={feature.properties.name}
              d={path(feature) ?? undefined}
              className={
                active
                  ? "fill-ink-900 stroke-paper-50"
                  : region
                    ? "cursor-pointer fill-[#dbe7f5] stroke-paper-50 hover:fill-[#c3d6ee]"
                    : "fill-paper-200 stroke-paper-50"
              }
              strokeWidth={1.5}
              onClick={region ? () => onSelect(region.key) : undefined}
            >
              {region ? <title>{`${region.name}: ${region.items.length}`}</title> : null}
            </path>
          );
        })}
      </g>
      <g>
        {bubbles.map(({ spot, x, y, r }) => {
          const active = spot.key === selected;
          return (
            <g key={spot.key} className="cursor-pointer" onClick={() => onSelect(spot.key)}>
              {/* A wider invisible ring: small bubbles stay easy to hit with a thumb */}
              <circle cx={x} cy={y} r={Math.max(r, 14)} fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r={r}
                className={active ? "fill-ink-900 stroke-paper-50" : "fill-accent-blue/80 stroke-paper-50 hover:fill-accent-blue"}
                strokeWidth={1.5}
              />
              <title>{`${spot.name}: ${spot.items.length}`}</title>
            </g>
          );
        })}
      </g>
      <g className="pointer-events-none">
        {bubbles
          .filter(({ spot }) => labelled.has(spot.key) || spot.key === selected)
          .map(({ spot, x, y, r }) => (
            <text
              key={spot.key}
              x={x + r + 4}
              y={y + 4}
              className={`font-sans text-[13px] font-semibold ${spot.key === selected ? "fill-ink-900" : "fill-ink-700"}`}
              style={{ paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 3, strokeLinejoin: "round" }}
            >
              {spot.name}
            </text>
          ))}
      </g>
    </svg>
  );
}
