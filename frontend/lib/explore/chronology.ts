/**
 * Tijdlijn (Epic 14): one time axis for this news. Background and earlier episodes of the same story
 * → this news (first article per outlet, moments from the analysis) → later episodes and what is
 * still to come.
 *
 * "Same story" replaces "Volg het spoor": a related event counts only when it shares people or
 * organisations; relations that are related by theme, category or country alone are dropped
 * (62% of all relations, and they mostly led to unrelated news). Other news that shares one name is
 * not followed here: the name itself opens "Ook in ander nieuws". Pure.
 */

import type { EventRelation, RelationReason } from "@/lib/types";

import { firstReporters, parseTimelineTime } from "./timeline";
import { stripMarkdown } from "./summary";
import type { ExploreInput } from "./types";

/** A related event shares at least this many names (one a person or organisation) to be the same story */
export const SAME_STORY_MIN_SHARED = 2;
/** …and starts at most this far from this news */
export const SAME_STORY_MAX_DAYS = 14;
const DAY = 86_400_000;
/** A moment this long before the first or after the last article is not part of this news */
const NEWS_MARGIN = DAY;

const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);

export interface Episode {
  eventId: number;
  slug: string | null;
  title: string;
  firstSeenAt: string | null;
  articleCount: number | null;
}

export interface StoryThread {
  earlier: Episode[];
  /** Same story, around the same time (often the same news at another outlet) */
  alongside: Episode[];
  later: Episode[];
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
  };
}

/** Earlier, simultaneous and later episodes of the same story. */
export function storyThread(input: Pick<ExploreInput, "event" | "relations" | "articles">): StoryThread {
  const start = newsStart(input);
  const thread: StoryThread = { earlier: [], alongside: [], later: [] };

  for (const relation of input.relations ?? []) {
    // Theme, category, place or country alone, or one shared name: not the same story
    if (sharedEntities(relation).length === 0 || sharedNames(relation).length < SAME_STORY_MIN_SHARED) continue;
    const item = episode(relation);
    const t = time(item.firstSeenAt);
    const days = Number.isNaN(t) || Number.isNaN(start) ? Number.POSITIVE_INFINITY : Math.abs(t - start) / DAY;
    if (days > SAME_STORY_MAX_DAYS) continue;
    if (days <= 1) thread.alongside.push(item);
    else if (t < start) thread.earlier.push(item);
    else thread.later.push(item);
  }
  const byTime = (a: Episode, b: Episode) => (time(a.firstSeenAt) || 0) - (time(b.firstSeenAt) || 0);
  thread.earlier.sort(byTime);
  thread.alongside.sort(byTime);
  thread.later.sort(byTime);
  return thread;
}

/** A row of this news: the first article of an outlet, or a moment from the analysis */
export type ChronologyRow =
  | { kind: "publication"; t: number; outletKey: string; lagMinutes: number }
  | { kind: "moment"; t: number; headline: string; timelineIndex: number };

/** A row before or after this news: a moment from the analysis, or another episode of the story */
export type StoryRow =
  | { kind: "moment"; t: number; yearOnly: boolean; headline: string; timelineIndex: number }
  | { kind: "episode"; t: number; episode: Episode };

export interface Chronology {
  /** Background and earlier episodes of the story, oldest first */
  before: StoryRow[];
  /** This news: first article per outlet and moments from the analysis, in time order */
  rows: ChronologyRow[];
  /** Later episodes and moments after this news (also the ones still to come), oldest first */
  after: StoryRow[];
  /** From the first to the last article of this news */
  span: { start: number; end: number };
}

/** Where a moment goes on the axis: before this news, in it, or after it. */
export function partOf(t: number, span: Chronology["span"]): "before" | "news" | "after" {
  if (t < span.start - NEWS_MARGIN) return "before";
  if (t > span.end + NEWS_MARGIN) return "after";
  return "news";
}

/**
 * This news on one axis: the story before it (background moments, earlier episodes), its
 * publications (with delay) and moments, and the story after it (later episodes, what is to come).
 * Every moment at its own date, also the ones after the last article.
 */
export function chronology(input: ExploreInput): Chronology {
  const published = input.articles.map((article) => time(article.publishedAt)).filter((t) => !Number.isNaN(t));
  const first = published.length ? Math.min(...published) : time(input.event.firstSeenAt);
  const span = { start: first, end: published.length ? Math.max(...published) : first };
  const result: Chronology = {
    before: [],
    rows: firstReporters(input, { includeInternational: true }).map((entry) => ({
      kind: "publication",
      t: Date.parse(entry.publishedAt as string),
      outletKey: entry.outletKey,
      lagMinutes: entry.lagMinutes,
    })),
    after: [],
    span,
  };

  (input.insight?.timeline ?? []).forEach((item, timelineIndex) => {
    if (!item.headline?.trim()) return;
    const parsed = parseTimelineTime(item.time, item.headline);
    if (!parsed.date) return;
    const t = parsed.date.getTime();
    const part = partOf(t, span);
    // A year alone ("2019") is never a moment of this news
    if (part === "news" && !parsed.yearOnly) result.rows.push({ kind: "moment", t, headline: item.headline, timelineIndex });
    else result[part === "after" ? "after" : "before"].push({ kind: "moment", t, yearOnly: parsed.yearOnly, headline: item.headline, timelineIndex });
  });

  const thread = storyThread(input);
  const newsAt = newsStart(input);
  for (const episode of [...thread.earlier, ...thread.alongside, ...thread.later]) {
    const t = time(episode.firstSeenAt);
    result[t < newsAt ? "before" : "after"].push({ kind: "episode", t, episode });
  }

  const byTime = (a: { t: number }, b: { t: number }) => a.t - b.t;
  result.before.sort(byTime);
  result.after.sort(byTime);
  // A moment before the article that reports it
  result.rows.sort((a, b) => a.t - b.t || (a.kind === "moment" ? -1 : 1));
  return result;
}
