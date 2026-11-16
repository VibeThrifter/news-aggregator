"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid, geoContains, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

import { tintStep, type Spot } from "@/lib/kaart/data";

type Country = Feature<Geometry, { name?: string }> & { iso: string | null };

interface World {
  countries: Country[];
  byIso: Map<string, Country>;
}

let worldCache: World | null = null;

async function loadWorld(): Promise<World> {
  if (worldCache) return worldCache;
  const [topoModule, isoModule] = await Promise.all([
    import("@/lib/kaart/geo/world-110m.json"),
    import("@/lib/kaart/geo/iso-numeric.json"),
  ]);
  const topology = (topoModule.default ?? topoModule) as unknown as Topology<{ countries: GeometryCollection }>;
  const isoNumeric = (isoModule.default ?? isoModule) as unknown as Record<string, string>;
  const isoOf = new Map(Object.entries(isoNumeric).map(([iso, numeric]) => [numeric, iso]));
  const collection = feature(topology, topology.objects.countries) as FeatureCollection<Geometry, { name?: string }>;
  const countries = collection.features.map((country) => ({
    ...country,
    iso: isoOf.get(String(country.id ?? "").padStart(3, "0")) ?? null,
  }));
  const byIso = new Map<string, Country>();
  for (const country of countries) if (country.iso) byIso.set(country.iso, country);
  worldCache = { countries, byIso };
  return worldCache;
}

/** White sea, grey land, countries with news in five blues, the chosen one black. */
const TINTS = ["#ebebeb", "#dbe7f5", "#bcd3ee", "#8fb5e3", "#5b92d6", "#1F75CE"];
const SELECTED = "#1a1a1a";
/** A country smaller than this on screen (px²) also gets a dot, so it can be seen and tapped */
const DOT_AREA = 60;
const TAP_SLOP = 6;
const HIT_RADIUS = 16;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** Where the globe turns to for a spot: the middle of its country, else its own point. */
function focusOf(spot: Spot, world: World | null): [number, number] | null {
  const country = world?.byIso.get(spot.iso);
  if (country) return geoCentroid(country as GeoPermissibleObjects) as [number, number];
  if (spot.lon !== null && spot.lat !== null) return [spot.lon, spot.lat];
  return null;
}

/**
 * A globe that turns: sideways with a finger (up and down scrolls the page), any way with a mouse.
 * Countries with news are tinted after how much there is; a tap or a pill selects one and the globe
 * turns to it.
 */
export function WorldGlobe({
  spots,
  selected,
  onSelect,
}: {
  spots: Spot[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [world, setWorld] = useState<World | null>(worldCache);
  const [size, setSize] = useState(0);
  const rotation = useRef<[number, number]>([-5, -30]);
  const animation = useRef<number | null>(null);
  const dotsRef = useRef<{ x: number; y: number; spot: Spot }[]>([]);
  const drag = useRef<{ x: number; y: number; start: [number, number]; moved: boolean; id: number } | null>(null);

  useEffect(() => {
    let alive = true;
    loadWorld().then((loaded) => {
      if (alive) setWorld(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    // The size comes from CSS; the measure only sets the drawing resolution, so a scrollbar that
    // comes and goes cannot make the globe and the page resize each other in a loop
    const measure = () => setSize(Math.round(element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const spotByIso = useMemo(() => new Map(spots.map((spot) => [spot.iso, spot])), [spots]);
  const selectedSpot = useMemo(() => spots.find((spot) => spot.key === selected) ?? null, [spots, selected]);

  const projection = useMemo(
    () =>
      geoOrthographic()
        .scale(size / 2 - 2)
        .translate([size / 2, size / 2])
        .clipAngle(90)
        .precision(0.5),
    [size],
  );

  const draw = useCallback(() => {
    const element = canvas.current;
    if (!element || !size) return;
    const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    if (element.width !== Math.round(size * ratio)) {
      element.width = Math.round(size * ratio);
      element.height = Math.round(size * ratio);
    }
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    projection.rotate([rotation.current[0], rotation.current[1], 0]);
    const path = geoPath(projection, context);

    context.beginPath();
    path({ type: "Sphere" });
    context.fillStyle = "#ffffff";
    context.fill();

    context.beginPath();
    path(geoGraticule10());
    context.strokeStyle = "#f0f0f0";
    context.lineWidth = 0.6;
    context.stroke();

    const dots: { x: number; y: number; spot: Spot }[] = [];
    const centre = projection.invert?.([size / 2, size / 2]) as [number, number] | undefined;
    if (world) {
      for (const country of world.countries) {
        const spot = country.iso ? spotByIso.get(country.iso) : undefined;
        context.beginPath();
        path(country as GeoPermissibleObjects);
        context.fillStyle = spot ? (spot.key === selected ? SELECTED : TINTS[tintStep(spot.items.length)]) : TINTS[0];
        context.fill();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 0.7;
        context.stroke();
      }
    }
    // Dots for news in a country too small to see, or missing from the 1:110m map (Bahrain, Malta)
    for (const spot of spots) {
      const country = world?.byIso.get(spot.iso);
      if (country && path.area(country as GeoPermissibleObjects) >= DOT_AREA) continue;
      const point = focusOf(spot, world);
      if (!point) continue;
      // Only on the front of the globe
      if (centre && angleBetween(centre, point) > 88) continue;
      const projected = projection(point);
      if (projected) dots.push({ x: projected[0], y: projected[1], spot });
    }
    for (const { x, y, spot } of dots) {
      context.beginPath();
      context.arc(x, y, spot.key === selected ? 5 : 4, 0, Math.PI * 2);
      context.fillStyle = spot.key === selected ? SELECTED : TINTS[Math.max(3, tintStep(spot.items.length))];
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1.5;
      context.stroke();
    }
    dotsRef.current = dots;

    context.beginPath();
    path({ type: "Sphere" });
    context.strokeStyle = "#e0e0e0";
    context.lineWidth = 1;
    context.stroke();
  }, [projection, selected, size, spotByIso, spots, world]);

  useEffect(draw, [draw]);

  // Turn to the selected country (a pill, the URL or a tap)
  useEffect(() => {
    if (!selectedSpot || !world) return;
    const point = focusOf(selectedSpot, world);
    if (!point) return;
    const target: [number, number] = [-point[0], Math.max(-60, Math.min(60, -point[1]))];
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    if (prefersReducedMotion()) {
      rotation.current = target;
      draw();
      return;
    }
    const from: [number, number] = [...rotation.current];
    // The short way round
    let delta = (((target[0] - from[0]) % 360) + 540) % 360 - 180;
    if (Math.abs(delta) < 0.01) delta = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 750);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      rotation.current = [from[0] + delta * eased, from[1] + (target[1] - from[1]) * eased];
      draw();
      animation.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
    return () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
    };
    // Only when the choice changes, not on every redraw
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpot?.key, world]);

  const pick = (x: number, y: number) => {
    const near = dotsRef.current
      .map((dot) => ({ dot, distance: Math.hypot(dot.x - x, dot.y - y) }))
      .filter(({ distance }) => distance <= HIT_RADIUS)
      .sort((a, b) => a.distance - b.distance)[0];
    if (near) {
      onSelect(near.dot.spot.key);
      return;
    }
    if (Math.hypot(x - size / 2, y - size / 2) > size / 2) return;
    const point = projection.invert?.([x, y]);
    if (!point || !world) return;
    const country = world.countries.find((candidate) => geoContains(candidate as GeoPermissibleObjects, point));
    const spot = country?.iso ? spotByIso.get(country.iso) : undefined;
    if (spot) onSelect(spot.key);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (animation.current !== null) {
      cancelAnimationFrame(animation.current);
      animation.current = null;
    }
    drag.current = { x: event.clientX, y: event.clientY, start: [...rotation.current], moved: false, id: event.pointerId };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    if (!current.moved) {
      current.moved = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const degrees = 180 / Math.max(size, 1);
    // A finger only turns sideways: up and down belongs to the page
    const tilt = event.pointerType === "touch" ? 0 : -dy * degrees;
    rotation.current = [current.start[0] + dx * degrees, Math.max(-70, Math.min(70, current.start[1] + tilt))];
    draw();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved) return;
    const box = event.currentTarget.getBoundingClientRect();
    const scale = box.width ? size / box.width : 1;
    pick((event.clientX - box.left) * scale, (event.clientY - box.top) * scale);
  };

  return (
    <div ref={wrapper} className="mx-auto aspect-square w-full max-w-[560px]">
      {size ? (
        <canvas
          ref={canvas}
          width={size}
          height={size}
          style={{ touchAction: "pan-y" }}
          className="block h-full w-full cursor-grab select-none active:cursor-grabbing"
          role="img"
          aria-label="Wereldbol met de landen waar het nieuws speelt; kies een land met de knoppen eronder"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      ) : null}
    </div>
  );
}

/** Angle in degrees between two points on the sphere. */
function angleBetween(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const [l1, p1] = [a[0] * toRad, a[1] * toRad];
  const [l2, p2] = [b[0] * toRad, b[1] * toRad];
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / toRad;
}
