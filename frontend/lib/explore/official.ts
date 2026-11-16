/**
 * Official sources and traces around the articles (Stories 14.32–14.36). Pure; no AI anywhere:
 *
 * - Koppen die veranderen (14.32): the earlier headlines of an article (`titleHistory`).
 * - Kamervragen (14.33): sets of written questions that link to an article of this news, who asked.
 * - Stemming (14.33): how the Tweede Kamer voted on a motion or amendment in the Tijdlijn.
 * - Citaat uit het persbericht (14.34): quotes and text of a Rijksoverheid release that stand word
 *   for word in an article.
 * - Tegelijk verschenen (14.35): three or more outlets that publish this news within two minutes.
 * - Onderzoek in opdracht van (14.36): who ordered a study an article reports.
 *
 * Every line states what is there ("staat letterlijk in het persbericht"), never a verdict about
 * why ("overgeschreven").
 */

import type { EventDocument, KamerVote } from "@/lib/types";

import { firstReporters } from "./timeline";
import type { ExploreArticle, ExploreInput } from "./types";

// --- Documents ---------------------------------------------------------------------------------

export const KAMERVRAGEN_SOURCE = "kamervragen";
export const PERSBERICHT_SOURCE = "persbericht";

export interface PressQuote {
  document: EventDocument;
  quotes: string[];
  /** Share of the article's own text (outside quotes) that stands in the release, 0..1 */
  share: number;
}

/** Article id → the press releases it quotes word for word */
export function pressQuotesByArticle(documents: EventDocument[] | undefined): Map<number, PressQuote[]> {
  const map = new Map<number, PressQuote[]>();
  for (const document of documents ?? []) {
    if (document.source !== PERSBERICHT_SOURCE) continue;
    for (const entry of document.details?.quoted_by ?? []) {
      if (typeof entry?.article_id !== "number") continue;
      const quotes = Array.isArray(entry.quotes) ? entry.quotes.filter((quote) => typeof quote === "string" && quote.trim()) : [];
      const share = typeof entry.share === "number" && Number.isFinite(entry.share) ? entry.share : 0;
      if (!quotes.length && share <= 0) continue;
      const list = map.get(entry.article_id) ?? [];
      list.push({ document, quotes, share });
      map.set(entry.article_id, list);
    }
  }
  return map;
}

/** Article id → the sets of Kamervragen that link to it */
export function kamervragenByArticle(documents: EventDocument[] | undefined): Map<number, EventDocument[]> {
  const map = new Map<number, EventDocument[]>();
  for (const document of documents ?? []) {
    if (document.source !== KAMERVRAGEN_SOURCE) continue;
    for (const cite of document.details?.cites ?? []) {
      if (typeof cite?.article_id !== "number") continue;
      const list = map.get(cite.article_id) ?? [];
      if (!list.includes(document)) list.push(document);
      map.set(cite.article_id, list);
    }
  }
  return map;
}

/** The outlets whose articles a document cites (Kamervragen) or that quote it (press release), in order */
export function documentOutlets(document: EventDocument, articles: ExploreArticle[]): string[] {
  const ids = [
    ...(document.details?.cites ?? []).map((cite) => cite.article_id),
    ...(document.details?.quoted_by ?? []).map((entry) => entry.article_id),
  ];
  const names: string[] = [];
  for (const id of ids) {
    const article = articles.find((candidate) => candidate.id === id);
    const fallback = [...(document.details?.cites ?? []), ...(document.details?.quoted_by ?? [])].find((entry) => entry.article_id === id)?.outlet;
    const name = article?.outletName ?? fallback ?? null;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** "Aangenomen: voor D66, PRO, VVD en 4 andere (88 zetels), tegen PVV en JA21 (62)" */
export function voteSummary(vote: KamerVote | null | undefined, shown = 3): string | null {
  if (!vote?.result) return null;
  const side = (parties: [string, number][], seats: number, label: string) => {
    if (!parties?.length) return null;
    const names = parties.slice(0, shown).map(([party]) => party);
    const rest = parties.length - names.length;
    const list = rest > 0 ? `${names.join(", ")} en ${rest} andere` : joinDutch(names);
    return `${label} ${list} (${seats} ${seats === 1 ? "zetel" : "zetels"})`;
  };
  const parts = [side(vote.for, vote.seats_for, "voor"), side(vote.against, vote.seats_against, "tegen")].filter(Boolean);
  return parts.length ? `${vote.result}: ${parts.join(", ")}` : vote.result;
}

function joinDutch(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
}

// --- Measured copying (replaces the analysis's guess "Kopieergedrag") --------------------------

export interface MeasuredCopying {
  /** Highest share of an article's text that other outlets have word for word (Story 14.27) */
  sameTextShare: number | null;
  /** The outlets it shares that text with */
  sameTextWith: string[];
  /** Quotes from Rijksoverheid releases that stand word for word in its articles */
  pressQuotes: number;
  /** The organisations of those releases */
  pressFrom: string[];
}

/** What was measured about copied text in an outlet's articles of this news. */
export function measuredCopying(input: Pick<ExploreInput, "articles" | "documents">, outletKey: string): MeasuredCopying {
  const own = input.articles.filter((article) => article.outletKey === outletKey);
  const result: MeasuredCopying = { sameTextShare: null, sameTextWith: [], pressQuotes: 0, pressFrom: [] };
  for (const article of own) {
    if (!article.copy) continue;
    if (result.sameTextShare === null || article.copy.share > result.sameTextShare) result.sameTextShare = article.copy.share;
    const match = input.articles.find((candidate) => candidate.id === article.copy?.match);
    if (match && match.outletKey !== outletKey && !result.sameTextWith.includes(match.outletName)) result.sameTextWith.push(match.outletName);
  }
  const press = pressQuotesByArticle(input.documents);
  for (const article of own) {
    for (const quoted of press.get(article.id) ?? []) {
      result.pressQuotes += quoted.quotes.length;
      const from = quoted.document.location?.trim() || "de Rijksoverheid";
      if ((quoted.quotes.length || quoted.share > 0) && !result.pressFrom.includes(from)) result.pressFrom.push(from);
    }
  }
  return result;
}

/** "62 % dezelfde tekst als NOS · 2 citaten uit een persbericht"; null when nothing was measured */
export function measuredCopyingLabel(measured: MeasuredCopying): string | null {
  const parts: string[] = [];
  if (measured.sameTextShare !== null && measured.sameTextShare > 0) {
    const percent = Math.round(measured.sameTextShare * 100);
    parts.push(measured.sameTextWith.length ? `${percent} % dezelfde tekst als ${joinDutch(measured.sameTextWith)}` : `${percent} % dezelfde tekst`);
  }
  if (measured.pressQuotes > 0) {
    parts.push(`${measured.pressQuotes} ${measured.pressQuotes === 1 ? "citaat" : "citaten"} uit een persbericht`);
  } else if (measured.pressFrom.length) {
    parts.push("tekst uit een persbericht");
  }
  return parts.length ? parts.join(" · ") : null;
}

// --- Tegelijk verschenen ------------------------------------------------------------------------

/** Outlets publishing within this window count as at the same time */
export const TOGETHER_WINDOW_MINUTES = 2;
export const TOGETHER_MIN_OUTLETS = 3;

export interface TogetherCluster {
  t: number;
  outletKeys: string[];
}

/**
 * Three or more outlets that publish their first article of this news within two minutes of each
 * other: a time agreed beforehand (an embargo, a press conference). Each outlet once; clusters do
 * not overlap.
 */
export function togetherClusters(input: ExploreInput): TogetherCluster[] {
  const firsts = firstReporters(input, { includeInternational: true }).map((entry) => ({
    outletKey: entry.outletKey,
    t: Date.parse(entry.publishedAt as string),
  }));
  const window = TOGETHER_WINDOW_MINUTES * 60_000;
  const clusters: TogetherCluster[] = [];
  let i = 0;
  while (i < firsts.length) {
    let j = i;
    while (j + 1 < firsts.length && firsts[j + 1].t - firsts[i].t <= window) j++;
    if (j - i + 1 >= TOGETHER_MIN_OUTLETS) {
      clusters.push({ t: firsts[i].t, outletKeys: firsts.slice(i, j + 1).map((entry) => entry.outletKey) });
      i = j + 1;
    } else {
      i++;
    }
  }
  return clusters;
}

// --- Koppen die veranderen ----------------------------------------------------------------------

export interface HeadlineChangeRow {
  t: number;
  articleId: number;
  outletKey: string;
  from: string;
  to: string;
}

/** Every headline change of the articles of this news: from the earlier headline to the next one. */
export function headlineChanges(articles: ExploreArticle[]): HeadlineChangeRow[] {
  const rows: HeadlineChangeRow[] = [];
  for (const article of articles) {
    const history = article.titleHistory ?? [];
    history.forEach((entry, i) => {
      const t = Date.parse(entry.until);
      if (Number.isNaN(t)) return;
      rows.push({ t, articleId: article.id, outletKey: article.outletKey, from: entry.title, to: history[i + 1]?.title ?? article.title });
    });
  }
  return rows.sort((a, b) => a.t - b.t);
}

// --- Onderzoek in opdracht van ------------------------------------------------------------------

/** "Onderzoek van Q&A in opdracht van Independer", "Onderzoek in opdracht van AD zelf" */
export function sponsoredLabel(study: { sponsor: string; researcher: string | null; self: boolean }, outletName: string): string {
  const sponsor = study.self ? `${outletName} zelf` : study.sponsor;
  return study.researcher ? `Onderzoek van ${study.researcher} in opdracht van ${sponsor}` : `Onderzoek in opdracht van ${sponsor}`;
}
