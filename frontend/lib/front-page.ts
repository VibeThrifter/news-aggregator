/**
 * The front page: which news leads, the news per day, and per news item the bits of the event page
 * that fit on a card (what each outlet reported, a claim without evidence, the next part of the
 * story), in the words of the analysis. What is there, not what is missing.
 */

import { findOutletByName } from "@/lib/explore/media-landscape";
import { outletSentencesIn } from "@/lib/explore/outlet-sentences";
import { capitalize, parseSourcePart } from "@/lib/explore/speakers";
import { splitLlmSummary, splitSentences, stripMarkdown, truncate } from "@/lib/explore/summary";
import { parseIsoDate } from "@/lib/format";
import type { EventListItem } from "@/lib/types";

/** The top stories are picked from the news of the last day (before the newest news item)… */
const TOP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** …and at least from this many newest news items */
const TOP_CANDIDATES = 15;

/** The whole LLM title (the list cuts it at 60 characters; the cards clamp it themselves). */
export function fullTitle(event: Pick<EventListItem, "title" | "summary">): string {
  return splitLlmSummary(event.summary).title ?? event.title;
}

/** Dutch outlets of a news item, most articles first. */
export function dutchOutletNames(event: Pick<EventListItem, "source_breakdown">): string[] {
  const counts = new Map<string, number>();
  for (const entry of event.source_breakdown ?? []) {
    if (entry.is_international) continue;
    counts.set(entry.source, (counts.get(entry.source) ?? 0) + entry.article_count);
  }
  return Array.from(counts).sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** Number of foreign outlets of a news item. */
export function foreignOutletCount(event: Pick<EventListItem, "source_breakdown">): number {
  return new Set((event.source_breakdown ?? []).filter((entry) => entry.is_international).map((entry) => entry.source)).size;
}

function newsTime(event: Pick<EventListItem, "last_updated_at">): number {
  return parseIsoDate(event.last_updated_at)?.getTime() ?? 0;
}

/** Newest news first (the time Dutch media last wrote about it). */
export function sortByNews<T extends Pick<EventListItem, "last_updated_at">>(events: T[]): T[] {
  return [...events].sort((a, b) => newsTime(b) - newsTime(a));
}

/** Outlets shown in the balloons of the lead */
export const LEAD_QUOTES = 3;
/** Length of the teaser of the lead: a short start, the balloons tell the rest */
export const LEAD_TEASER = 220;

/**
 * The top stories, from the news of the last day: first what most Dutch outlets brought (one, two,
 * three or more: the lead is about who says what), then where the small picture of the lead shows
 * the most (an outlet the analysis says what it reported of, a claim without evidence), then the
 * most Dutch outlets, the most outlets in all, the newest. News without an analysis comes last.
 */
export function pickTopStories<T extends Pick<EventListItem, "last_updated_at" | "source_breakdown" | "has_llm_insights" | "summary" | "claims">>(
  events: T[],
  count: number,
): T[] {
  const sorted = sortByNews(events);
  const cutoff = (sorted.length ? newsTime(sorted[0]) : 0) - TOP_WINDOW_MS;
  const candidates = sorted.filter((event, index) => index < TOP_CANDIDATES || newsTime(event) >= cutoff);
  const score = (event: T) => {
    const dutch = dutchOutletNames(event).length;
    return [
      event.has_llm_insights === false ? 0 : 1,
      Math.min(dutch, LEAD_QUOTES),
      outletQuotes(event, { max: LEAD_QUOTES, teaser: teaserOf(event.summary, LEAD_TEASER) }).length + (frontClaim(event) ? 1 : 0),
      dutch,
      dutch + foreignOutletCount(event),
      newsTime(event),
    ];
  };
  return candidates
    .map((event) => ({ event, score: score(event) }))
    .sort((a, b) => {
      for (let i = 0; i < a.score.length; i += 1) {
        if (a.score[i] !== b.score[i]) return b.score[i] - a.score[i];
      }
      return 0;
    })
    .slice(0, count)
    .map((entry) => entry.event);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const weekdayDate = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const fullDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });

/** "Vandaag", "Gisteren", "Donderdag 2 oktober"; with the year when it is from another year. */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return "Vandaag";
  if (dayKey(date) === dayKey(yesterday)) return "Gisteren";
  const label = date.getFullYear() === now.getFullYear() ? weekdayDate.format(date) : fullDate.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface NewsDay<T> {
  key: string;
  label: string;
  events: T[];
}

/** The news per day, newest day first and newest news first within a day. */
export function groupByDay<T extends Pick<EventListItem, "last_updated_at">>(events: T[], now: Date = new Date()): NewsDay<T>[] {
  const days: NewsDay<T>[] = [];
  for (const event of sortByNews(events)) {
    const date = parseIsoDate(event.last_updated_at);
    const key = date ? dayKey(date) : "onbekend";
    let day = days.find((item) => item.key === key);
    if (!day) {
      day = { key, label: date ? dayLabel(date, now) : "Zonder datum", events: [] };
      days.push(day);
    }
    day.events.push(event);
  }
  return days;
}

/** The start of the story: whole sentences of the first paragraph, up to about `max` characters. */
export function teaserOf(summary: string | null | undefined, max: number): string {
  const { firstParagraph } = splitLlmSummary(summary);
  if (!firstParagraph) return "";
  let teaser = "";
  for (const sentence of splitSentences(firstParagraph)) {
    const next = teaser ? `${teaser} ${sentence}` : sentence;
    if (teaser && next.length > max) break;
    teaser = next;
  }
  return truncate(teaser, max);
}

export interface OutletQuote {
  outlet: string;
  text: string;
}

/** Sentences about the sources themselves, not about the news ("de enige Nederlandse bron"). */
const ABOUT_SOURCES =
  /\b(enige|één|ene) (Nederlandse |buitenlandse |internationale )?(bron|artikel)\b|\bslechts één\b|\bgeen (andere|enkele|internationale)\b|\bbeschikbaar\b|\bafkomstig (van|uit)\b/i;

/**
 * What each Dutch outlet reported, in the words of the analysis: per outlet the first sentence of
 * the summary that names it, leaving out what the teaser already says and sentences about the
 * sources themselves. Outlets the summary does not name are left out.
 */
export function outletQuotes(
  event: Pick<EventListItem, "summary" | "source_breakdown">,
  options: { max: number; length?: number; teaser?: string },
): OutletQuote[] {
  const names = dutchOutletNames(event);
  if (!event.summary || names.length === 0) return [];
  const outlets = names.map((name) => ({ key: name, name, profile: { aliases: findOutletByName(name)?.aliases ?? [] } }));
  const sentences = outletSentencesIn(splitLlmSummary(event.summary).body, outlets);
  const teaser = options.teaser?.replace(/…$/, "") ?? "";
  const quotes: OutletQuote[] = [];
  for (const name of names) {
    const text = (sentences.get(name) ?? [])
      .map((parts) => parts.map((part) => part.text).join(""))
      .find((sentence) => !ABOUT_SOURCES.test(sentence) && !(teaser && overlaps(sentence, teaser)));
    if (text) quotes.push({ outlet: name, text: truncate(text, options.length ?? 180) });
    if (quotes.length >= options.max) break;
  }
  return quotes;
}

function overlaps(sentence: string, teaser: string): boolean {
  const head = sentence.slice(0, 60);
  return teaser.includes(head) || sentence.includes(teaser.slice(0, 60));
}

export interface FrontClaim {
  claim: string;
  /** Who makes it ("Jan-Willem van den Beukel"), an outlet that claims it itself, or nobody named */
  speaker: string | null;
  /** Their organisation or role ("Vemobin", "premier van Israël") */
  role: string | null;
  /** The first question to ask about it */
  question: string | null;
  /** Made by someone with a name (not an outlet itself, not an anonymous source) */
  named: boolean;
}

/** Speakers without a name: "Niet-genoemde Franse media", "ongenoemde ingewijden" */
const UNNAMED = /\b(niet[- ]genoemde?|ongenoemde?|media)\b/i;

/**
 * The claim of "Klopt het?" on the front page: one a named speaker makes before one an outlet makes
 * itself, and one with a question before one without.
 */
export function frontClaim(event: Pick<EventListItem, "claims">): FrontClaim | null {
  let best: { claim: FrontClaim; score: number } | null = null;
  for (const item of event.claims ?? []) {
    const claim = item.claim.replace(/^['"‘’“”]+|['"‘’“”]+$/g, "").trim();
    if (!claim) continue;
    // "NieuwRechts (introductie) / Frits Bosch": the first part that is a source
    const parsed =
      (item.by ?? "")
        .split(/\s+\/\s+|;/)
        .map((part) => parseSourcePart(part))
        .find(Boolean) ?? null;
    const outlet = parsed ? parsed.own || Boolean(findOutletByName(parsed.name)) : false;
    const speaker = parsed ? (parsed.anonymous ? "Anonieme bron" : capitalize(parsed.name)) : null;
    const named = parsed && !parsed.anonymous && !outlet && !UNNAMED.test(parsed.name);
    const question = item.question?.trim() || null;
    const score = (named ? 2 : speaker ? 1 : 0) * 2 + (question ? 1 : 0);
    if (!best || score > best.score) {
      best = { claim: { claim, speaker, role: named ? (parsed.org ?? parsed.role) : null, question, named: Boolean(named) }, score };
    }
  }
  return best?.claim ?? null;
}

export interface StorySection {
  heading: string;
  /** The first sentence under the heading */
  text: string;
}

/** Headings about the sources or the coverage, not about the news ("Beperkte bronbasis", "Duiding") */
const ABOUT_COVERAGE = /\b(bron\w*|berichtgeving|duiding|framing|dekking|perspectie\w*|kanttekening\w*|beperking\w*|internationa\w*|media)\b/i;
/** Sentences about the article itself ("Het bericht van NU.nl is kort en bevat weinig details") */
const ABOUT_ARTICLE = /^(het|dit|dat) (bericht|artikel|stuk|item)\b/i;

/**
 * The next part of the story: the first heading of the summary that is about the news ("Reactie
 * van Zelensky", "Context en eerdere incidenten"), with the first sentence under it that the card
 * does not show yet (`shown`: the start of the story, the balloons).
 */
export function storySection(summary: string | null | undefined, shown: string[] = []): StorySection | null {
  const parts = splitLlmSummary(summary).body.split(/(?:^|\n)[ \t]*\*\*([^*\n]+)\*\*[ \t]*(?=\n|$)/);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim().replace(/[.:]$/, "");
    if (!heading || ABOUT_COVERAGE.test(heading)) continue;
    const paragraph = (parts[i + 1] ?? "").trim().split(/\n\s*\n/)[0] ?? "";
    const text = splitSentences(stripMarkdown(paragraph)).find(
      (sentence) => !ABOUT_SOURCES.test(sentence) && !ABOUT_ARTICLE.test(sentence) && !shown.some((other) => overlaps(sentence, other.replace(/…$/, ""))),
    );
    if (text) return { heading, text };
  }
  return null;
}

export type StoryHook = { kind: "claim"; claim: FrontClaim } | { kind: "section"; section: StorySection };

/**
 * What makes you read on, under the start of the story: a claim someone with a name makes ("Klopt
 * het?"), else the next part of the story. Not every card the same.
 */
export function storyHook(event: Pick<EventListItem, "claims" | "summary">, shown: string[] = []): StoryHook | null {
  const claim = frontClaim(event);
  if (claim?.named) return { kind: "claim", claim };
  const section = storySection(event.summary, shown);
  return section ? { kind: "section", section } : null;
}
