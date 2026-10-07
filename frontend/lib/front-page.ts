/**
 * The front page: which news leads, the news per day, and per news item the bits of "Wie zegt
 * wat?" that fit on a card (what each outlet reported, who is missing), in the words of the analysis.
 */

import { findOutletByName } from "@/lib/explore/media-landscape";
import { outletSentencesIn } from "@/lib/explore/outlet-sentences";
import { splitLlmSummary, splitSentences, truncate } from "@/lib/explore/summary";
import { parseIsoDate } from "@/lib/format";
import type { EventListItem } from "@/lib/types";

/** The newest news items the top stories are picked from */
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
 * The top stories, from the newest news: first where the analysis says what several Dutch outlets
 * reported (a conversation to show), then what most Dutch outlets brought, then the most outlets in
 * all, then the newest.
 */
export function pickTopStories<T extends Pick<EventListItem, "last_updated_at" | "source_breakdown" | "has_llm_insights" | "summary">>(
  events: T[],
  count: number,
): T[] {
  const candidates = sortByNews(events).slice(0, TOP_CANDIDATES);
  const score = (event: T) => [
    event.has_llm_insights === false ? 0 : 1,
    outletQuotes(event, { max: LEAD_QUOTES, teaser: teaserOf(event.summary, LEAD_TEASER) }).length,
    dutchOutletNames(event).length,
    dutchOutletNames(event).length + foreignOutletCount(event),
    newsTime(event),
  ];
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
