/**
 * Kaart: waar speelt het nieuws? (Epic 14, Story 14.38)
 *
 * `event_places` holds, per news item, the places its headline or the start of its Dutch articles
 * names (the backend decides this without AI: `backend/app/services/event_places.py`). This module
 * fetches those rows and groups them: per Dutch place for the map of the Netherlands, per country
 * for the globe. Pure functions apart from `fetchPlaceRows`.
 */

import { getSupabase } from "@/lib/supabase";

export type Beeld = "nederland" | "wereld";
export type Periode = "vandaag" | "week" | "maand";

export const PERIODE_HOURS: Record<Periode, number> = { vandaag: 24, week: 24 * 7, maand: 24 * 30 };
export const PERIODE_LABEL: Record<Periode, string> = { vandaag: "Vandaag", week: "Week", maand: "Maand" };
/** "12 nieuwsitems deze week" */
export const PERIODE_PHRASE: Record<Periode, string> = {
  vandaag: "het afgelopen etmaal",
  week: "deze week",
  maand: "deze maand",
};

export type PlaceKind = "country" | "city" | "region" | "place" | "municipality";

export interface PlaceRow {
  event_id: number;
  place_key: string;
  kind: PlaceKind;
  name: string;
  iso_code: string;
  region: string | null;
  lat: number | null;
  lon: number | null;
  article_count: number;
  in_title: boolean;
  outlets: string[] | null;
  event_slug: string | null;
  event_title: string;
  event_type: string | null;
  event_first_seen_at: string | null;
}

/** A news item in the list next to the map. */
export interface PlaceNewsItem {
  id: number;
  slug: string | null;
  title: string;
  outlets: string[];
  firstSeenAt: string | null;
}

/** A place on the map of the Netherlands, or a country on the globe. */
export interface Spot {
  key: string;
  name: string;
  /** Province (Netherlands) or the places in the country that the news names (globe) */
  detail: string | null;
  iso: string;
  kind: PlaceKind;
  lat: number | null;
  lon: number | null;
  items: PlaceNewsItem[];
}

const COLUMNS =
  "event_id,place_key,kind,name,iso_code,region,lat,lon,article_count,in_title,outlets,event_slug,event_title,event_type,event_first_seen_at";
/** PostgREST returns at most this many rows per request */
const PAGE = 1000;
/** Safety stop: a month is ~5,000 rows */
const MAX_PAGES = 20;

export function periodeStart(periode: Periode, now: Date = new Date()): Date {
  return new Date(now.getTime() - PERIODE_HOURS[periode] * 3600 * 1000);
}

/** The rows of the news that started in the period, and the names of the main sources. */
export async function fetchPlaceRows(periode: Periode): Promise<{ rows: PlaceRow[]; mainSources: string[] }> {
  const supabase = getSupabase();
  const since = periodeStart(periode).toISOString();
  const { data: sources } = await supabase
    .from("news_sources")
    .select("display_name")
    .eq("is_main_source", true)
    .eq("enabled", true);
  const mainSources = (sources ?? []).map((source: { display_name: string }) => source.display_name);

  const rows: PlaceRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("event_places")
      .select(COLUMNS)
      .gte("event_first_seen_at", since)
      .order("event_first_seen_at", { ascending: false })
      .order("event_id", { ascending: true })
      .order("place_key", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as PlaceRow[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, mainSources };
}

/**
 * The rows the page shows: news of a main source (as on the front page; no main source configured
 * = every row) in the chosen category ("all" = every category).
 */
export function visibleRows(rows: PlaceRow[], options: { mainSources: string[]; category: string }): PlaceRow[] {
  const main = new Set(options.mainSources);
  return rows.filter((row) => {
    if (options.category !== "all" && (row.event_type ?? "") !== options.category) return false;
    if (main.size === 0) return true;
    return (row.outlets ?? []).some((outlet) => main.has(outlet));
  });
}

function newsItem(row: PlaceRow): PlaceNewsItem {
  return {
    id: row.event_id,
    slug: row.event_slug,
    title: row.event_title,
    outlets: [...(row.outlets ?? [])].sort((a, b) => a.localeCompare(b, "nl")),
    firstSeenAt: row.event_first_seen_at,
  };
}

function newestFirst(a: PlaceNewsItem, b: PlaceNewsItem): number {
  return (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? "") || a.id - b.id;
}

function bySize(a: Spot, b: Spot): number {
  return b.items.length - a.items.length || a.name.localeCompare(b.name, "nl");
}

/** Places in the Netherlands (towns, municipalities, provinces), most news first. */
export function dutchSpots(rows: PlaceRow[]): Spot[] {
  const spots = new Map<string, Spot>();
  for (const row of rows) {
    if (row.iso_code !== "NL" || row.kind === "country") continue;
    let spot = spots.get(row.place_key);
    if (!spot) {
      spot = {
        key: row.place_key,
        name: row.name,
        detail: row.kind === "region" ? null : row.region,
        iso: "NL",
        kind: row.kind,
        lat: row.lat,
        lon: row.lon,
        items: [],
      };
      spots.set(row.place_key, spot);
    }
    if (!spot.items.some((item) => item.id === row.event_id)) spot.items.push(newsItem(row));
  }
  const list = Array.from(spots.values());
  for (const spot of list) spot.items.sort(newestFirst);
  return list.sort(bySize);
}

let displayNames: Intl.DisplayNames | null | undefined;

/** Dutch name of a country ("UA" -> "Oekraïne"); the stored name when the browser has none. */
export function countryName(iso: string, fallback: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["nl"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }
  try {
    const name = displayNames?.of(iso.toUpperCase());
    // An unknown code gives "onbekend gebied": a real name starts with a capital
    return name && name !== iso.toUpperCase() && name[0] === name[0].toUpperCase() ? name : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Countries abroad: a news item counts once for a country when it names the country or a place in
 * it. `detail` lists the places in it that the news names ("Kyiv, Charkiv").
 */
export function countrySpots(rows: PlaceRow[]): Spot[] {
  const spots = new Map<string, Spot & { places: Map<string, number> }>();
  for (const row of rows) {
    if (row.iso_code === "NL") continue;
    const iso = row.iso_code.toUpperCase();
    let spot = spots.get(iso);
    if (!spot) {
      spot = {
        key: `country:${iso.toLowerCase()}`,
        name: countryName(iso, row.kind === "country" ? row.name : iso),
        detail: null,
        iso,
        kind: "country",
        lat: row.lat,
        lon: row.lon,
        items: [],
        places: new Map(),
      };
      spots.set(iso, spot);
    }
    if (row.kind === "country") {
      // The capital is the country's point (a place row only had its own)
      spot.lat = row.lat;
      spot.lon = row.lon;
    } else {
      spot.places.set(row.name, (spot.places.get(row.name) ?? 0) + 1);
    }
    if (!spot.items.some((item) => item.id === row.event_id)) spot.items.push(newsItem(row));
  }
  const list: Spot[] = [];
  for (const { places, ...spot } of Array.from(spots.values())) {
    const named = Array.from(places.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl"))
      .map(([name]) => name);
    spot.detail = named.length ? named.slice(0, 4).join(", ") : null;
    spot.items.sort(newestFirst);
    list.push(spot);
  }
  return list.sort(bySize);
}

/** Five steps for the tint of a country: 1, 2, 3-5, 6-10, more. */
export function tintStep(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 5) return 3;
  if (count <= 10) return 4;
  return 5;
}

/** "1 nieuwsitem", "12 nieuwsitems" */
export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? "nieuwsitem" : "nieuwsitems"}`;
}

const TIME = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
const DAY = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
const DATE_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" });

/** "vandaag 14:05", "gisteren 09:30", "12 nov." (Dutch time) */
export function whenLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = DATE_KEY.format(date);
  if (day === DATE_KEY.format(now)) return `vandaag ${TIME.format(date)}`;
  if (day === DATE_KEY.format(new Date(now.getTime() - 24 * 3600 * 1000))) return `gisteren ${TIME.format(date)}`;
  return DAY.format(date);
}

export function parseBeeld(value: string | null): Beeld {
  return value === "wereld" ? "wereld" : "nederland";
}

export function parsePeriode(value: string | null): Periode {
  return value === "vandaag" || value === "maand" ? value : "week";
}
