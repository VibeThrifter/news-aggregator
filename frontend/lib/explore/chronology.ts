/**
 * Tijdlijn (Epic 14): one time axis for this news. Background → earlier episodes of the same story
 * → this news (first article per outlet, moments from the analysis) → later episodes.
 *
 * "Same story" replaces "Volg het spoor": a related event counts only when it shares people or
 * organisations; relations that are related by theme, category or country alone are dropped
 * (62% of all relations, and they mostly led to unrelated news). Pure.
 */

import type { EventRelation, RelationReason } from "@/lib/types";

import { buildScrubberModel, firstReporters } from "./timeline";
import { stripMarkdown } from "./summary";
import type { ExploreInput } from "./types";

/** A related event shares at least this many names (one a person or organisation) to be the same story */
export const SAME_STORY_MIN_SHARED = 2;
/** …and starts at most this far from this news */
export const SAME_STORY_MAX_DAYS = 14;
const DAY = 86_400_000;

const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);

export interface Episode {
  eventId: number;
  slug: string | null;
  title: string;
  firstSeenAt: string | null;
  articleCount: number | null;
  /** The people and organisations it shares with this news */
  shared: string[];
}

export interface PersonThread {
  key: string;
  name: string;
  kind: "person" | "org" | "group";
  episodes: Episode[];
}

export interface StoryThread {
  earlier: Episode[];
  /** Same story, around the same time (often the same news at another outlet) */
  alongside: Episode[];
  later: Episode[];
  /** Other news with the same people or organisations, per person/organisation */
  people: PersonThread[];
}

type EntityReason = Extract<RelationReason, { type: "entity" }>;

function isActor(reason: EntityReason): boolean {
  return reason.kind === "person" || reason.kind === "org" || reason.kind === "group";
}

/** People and organisations a relation shares (places only count towards "same story") */
function sharedEntities(relation: EventRelation): EntityReason[] {
  return (relation.reasons ?? []).filter((reason): reason is EntityReason => reason.type === "entity" && isActor(reason));
}

function sharedNames(relation: EventRelation): EntityReason[] {
  return (relation.reasons ?? []).filter((reason): reason is EntityReason => reason.type === "entity" && reason.kind !== "country");
}

/**
 * When this news started: its first Dutch article. The event's own start can be far off when an old
 * foreign article was attached to it.
 */
export function newsStart(input: Pick<ExploreInput, "event" | "articles">): number {
  const dutch = input.articles
    .filter((article) => !article.isInternational && article.publishedAt)
    .map((article) => Date.parse(article.publishedAt as string))
    .filter((t) => !Number.isNaN(t));
  return dutch.length ? Math.min(...dutch) : time(input.event.firstSeenAt);
}

function episode(relation: EventRelation): Episode {
  return {
    eventId: relation.related_event_id,
    slug: relation.related_slug ?? null,
    title: stripMarkdown(relation.related_title ?? ""),
    firstSeenAt: relation.related_first_seen_at ?? null,
    articleCount: relation.related_article_count ?? null,
    shared: sharedEntities(relation).map((reason) => reason.name),
  };
}


/** Earlier/later episodes of the same story, and other news per shared person or organisation. */
export function storyThread(input: Pick<ExploreInput, "event" | "relations" | "articles">): StoryThread {
  const start = newsStart(input);
  const thread: StoryThread = { earlier: [], alongside: [], later: [], people: [] };
  const people = new Map<string, PersonThread>();

  for (const relation of input.relations ?? []) {
    const shared = sharedEntities(relation);
    if (shared.length === 0) continue; // theme, category, place or country alone: not followed
    const item = episode(relation);
    const t = time(item.firstSeenAt);
    const days = Number.isNaN(t) || Number.isNaN(start) ? Number.POSITIVE_INFINITY : Math.abs(t - start) / DAY;
    if (sharedNames(relation).length >= SAME_STORY_MIN_SHARED && days <= SAME_STORY_MAX_DAYS) {
      if (days <= 1) thread.alongside.push(item);
      else if (t < start) thread.earlier.push(item);
      else thread.later.push(item);
      continue;
    }
    for (const reason of shared) {
      const entry = people.get(reason.key) ?? { key: reason.key, name: reason.name, kind: reason.kind as PersonThread["kind"], episodes: [] };
      if (!entry.episodes.some((existing) => existing.eventId === item.eventId)) entry.episodes.push(item);
      people.set(reason.key, entry);
    }
  }
  const byTime = (a: Episode, b: Episode) => (time(a.firstSeenAt) || 0) - (time(b.firstSeenAt) || 0);
  thread.earlier.sort(byTime);
  thread.alongside.sort(byTime);
  thread.later.sort(byTime);
  thread.people = Array.from(people.values())
    .map((entry) => ({ ...entry, episodes: entry.episodes.sort(byTime).reverse() }))
    .sort((a, b) => b.episodes.length - a.episodes.length || a.name.localeCompare(b.name, "nl"));
  return thread;
}

export type ChronologyRow =
  | { kind: "publication"; t: number; outletKey: string; lagMinutes: number }
  | { kind: "moment"; t: number; label: string; headline: string; timelineIndex: number };

export interface Chronology {
  /** Moments long before the coverage ("1995", "2009") */
  history: { label: string; headline: string; timelineIndex: number }[];
  /** This news: first article per outlet and moments from the analysis, in time order */
  rows: ChronologyRow[];
}

/** This news on one axis: background, publications (with delay) and moments. */
export function chronology(input: ExploreInput): Chronology {
  const model = buildScrubberModel(input);
  const publications: ChronologyRow[] = firstReporters(input, { includeInternational: true }).map((entry) => ({
    kind: "publication",
    t: Date.parse(entry.publishedAt as string),
    outletKey: entry.outletKey,
    lagMinutes: entry.lagMinutes,
  }));
  const moments: ChronologyRow[] = model.markers.map((marker) => ({
    kind: "moment",
    t: marker.t,
    label: marker.label,
    headline: marker.headline,
    timelineIndex: marker.index,
  }));
  return {
    history: model.history.map((marker) => ({ label: marker.label, headline: marker.headline, timelineIndex: marker.index })),
    rows: [...publications, ...moments].sort((a, b) => a.t - b.t || (a.kind === "moment" ? -1 : 1)),
  };
}
