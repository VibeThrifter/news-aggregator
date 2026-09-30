/**
 * Time helpers: formatting of LLM timeline items (moved from components/Timeline.tsx), the model
 * behind the Tijdlijn-scrubber and "who reported first".
 */

import type { TimelineEvent } from "@/lib/types";

import type { ExploreInput, OutletRef } from "./types";

const YEAR_ONLY = /^\d{4}$/;

export interface ParsedTimelineTime {
  date: Date | null;
  /** Only a year is known ("1934") */
  yearOnly: boolean;
  /** Label to display */
  label: string;
}

/**
 * Parse an LLM timeline time: "1934", "2025-12-28" or an ISO datetime.
 * Handles the 1970-01-01 bug (LLM wrote the year as Unix seconds) by taking the year from the headline.
 */
export function parseTimelineTime(time: string, headline?: string, now: Date = new Date()): ParsedTimelineTime {
  if (YEAR_ONLY.test(time)) {
    return { date: new Date(Date.UTC(Number(time), 0, 1)), yearOnly: true, label: time };
  }

  // Date without time ("2025-03-14"): a local calendar date, not UTC midnight (which shows as 01:00 in NL)
  const dateOnly = time.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(time);
  if (Number.isNaN(date.getTime())) {
    return { date: null, yearOnly: false, label: time };
  }

  if (date.getUTCFullYear() === 1970 && date.getUTCMonth() === 0 && date.getUTCDate() === 1) {
    const yearMatch = headline?.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
    if (yearMatch) {
      return { date: new Date(Date.UTC(Number(yearMatch[1]), 0, 1)), yearOnly: true, label: yearMatch[1] };
    }
    return { date: null, yearOnly: false, label: "–" };
  }

  return { date, yearOnly: false, label: formatDateLabel(date, now) };
}

function formatDateLabel(date: Date, now: Date): string {
  const day = date.getDate();
  const month = date.toLocaleDateString("nl-NL", { month: "short" });
  const year = date.getFullYear();
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;

  if (year !== now.getFullYear()) {
    return `${day} ${month} ${year}`;
  }
  if (hasTime) {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${day} ${month} ${hours}:${minutes}`;
  }
  return `${day} ${month} ${year}`;
}

export function formatTimelineTime(time: string, headline?: string, now?: Date): string {
  return parseTimelineTime(time, headline, now).label;
}

/** Outlets in the order they first reported, with the delay after the first report. */
export function firstReporters(input: ExploreInput, options: { includeInternational?: boolean } = {}): OutletRef[] {
  const firsts = new Map<string, number>();
  for (const article of input.articles) {
    if (article.isInternational && !options.includeInternational) continue;
    if (!article.publishedAt) continue;
    const t = Date.parse(article.publishedAt);
    if (Number.isNaN(t)) continue;
    const current = firsts.get(article.outletKey);
    if (current === undefined || t < current) {
      firsts.set(article.outletKey, t);
    }
  }
  const ordered = Array.from(firsts.entries()).sort((a, b) => a[1] - b[1]);
  const start = ordered[0]?.[1] ?? 0;
  return ordered.map(([outletKey, t]) => ({
    outletKey,
    publishedAt: new Date(t).toISOString(),
    lagMinutes: Math.round((t - start) / 60000),
  }));
}

export interface ScrubberDot {
  articleId: number;
  t: number;
}

export interface ScrubberLane {
  outletKey: string;
  name: string;
  isInternational: boolean;
  dots: ScrubberDot[];
}

export interface ScrubberMarker {
  index: number;
  t: number;
  label: string;
  headline: string;
}

export interface ScrubberModel {
  start: number;
  end: number;
  lanes: ScrubberLane[];
  /** LLM timeline items within the coverage window */
  markers: ScrubberMarker[];
  /** LLM timeline items before the coverage window ("Voorgeschiedenis") */
  history: ScrubberMarker[];
}

const HOUR = 60 * 60 * 1000;

/** Build lanes (one per outlet) with article dots, and split the LLM timeline into history and markers. */
export function buildScrubberModel(input: ExploreInput, timeline: TimelineEvent[] = input.insight?.timeline ?? []): ScrubberModel {
  const times = input.articles
    .map((article) => (article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN))
    .filter((t) => !Number.isNaN(t));

  let start = times.length ? Math.min(...times) : Number.NaN;
  let end = times.length ? Math.max(...times) : Number.NaN;
  if (Number.isNaN(start)) {
    start = input.event.firstSeenAt ? Date.parse(input.event.firstSeenAt) : Date.now();
  }
  if (Number.isNaN(end)) {
    end = input.event.lastUpdatedAt ? Date.parse(input.event.lastUpdatedAt) : start;
  }
  if (end - start < HOUR) {
    end = start + HOUR;
  }

  const outletOrder = [...input.outlets].sort((a, b) => {
    if (a.isInternational !== b.isInternational) return a.isInternational ? 1 : -1;
    const sa = a.isAlternative ? 11 : (a.spectrum ?? 5);
    const sb = b.isAlternative ? 11 : (b.spectrum ?? 5);
    return sa - sb || a.name.localeCompare(b.name, "nl");
  });

  const lanes: ScrubberLane[] = outletOrder.map((outlet) => ({
    outletKey: outlet.key,
    name: outlet.name,
    isInternational: outlet.isInternational,
    dots: input.articles
      .filter((article) => article.outletKey === outlet.key && article.publishedAt)
      .map((article) => ({ articleId: article.id, t: Date.parse(article.publishedAt as string) }))
      .filter((dot) => !Number.isNaN(dot.t))
      .sort((a, b) => a.t - b.t),
  }));

  const markers: ScrubberMarker[] = [];
  const history: ScrubberMarker[] = [];
  const windowStart = start - 24 * HOUR;
  timeline.forEach((item, index) => {
    const parsed = parseTimelineTime(item.time, item.headline);
    if (!parsed.date) return;
    const t = parsed.date.getTime();
    const marker = { index, t, label: parsed.label, headline: item.headline };
    if (parsed.yearOnly || t < windowStart) {
      history.push(marker);
    } else {
      markers.push({ ...marker, t: Math.min(Math.max(t, start), end) });
    }
  });
  history.sort((a, b) => a.t - b.t);
  markers.sort((a, b) => a.t - b.t);

  return { start, end, lanes, markers, history };
}

/** Human readable delay: "40 min later", "3 uur later", "2 dagen later". */
export function formatLag(minutes: number): string {
  if (minutes <= 0) return "als eerste";
  if (minutes < 60) return `${minutes} min later`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} uur later`;
  return `${Math.round(hours / 24)} dagen later`;
}
