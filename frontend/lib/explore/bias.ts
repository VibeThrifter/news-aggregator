/**
 * Bias (Epic 10) aggregated per outlet for an event.
 */

import type { SentenceBias } from "@/lib/types";

import type { ExploreInput } from "./types";

export interface OutletBias {
  outletKey: string;
  articleIds: number[];
  /** Average overall_journalist_rating (0 = objective .. 1 = strongly biased) */
  averageRating: number;
  /** Journalist-bias sentences (own text, framing, quote selection) */
  sentenceCount: number;
  quoteSentenceCount: number;
  topTypes: { type: string; count: number }[];
}

export interface BiasCard extends SentenceBias {
  articleId: number;
  outletKey: string;
}

/** Per-outlet bias summary for all outlets that have at least one analysed article. */
export function biasByOutlet(input: ExploreInput): Map<string, OutletBias> {
  const result = new Map<string, OutletBias>();
  const typeCounts = new Map<string, Map<string, number>>();

  for (const article of input.articles) {
    const analysis = input.bias[article.id];
    if (!analysis) continue;
    const entry = result.get(article.outletKey) ?? {
      outletKey: article.outletKey,
      articleIds: [],
      averageRating: 0,
      sentenceCount: 0,
      quoteSentenceCount: 0,
      topTypes: [],
    };
    entry.articleIds.push(article.id);
    entry.averageRating += analysis.summary.overall_journalist_rating;
    entry.sentenceCount += analysis.journalist_biases.length;
    entry.quoteSentenceCount += analysis.quote_biases.length;
    result.set(article.outletKey, entry);

    const counts = typeCounts.get(article.outletKey) ?? new Map<string, number>();
    for (const bias of analysis.journalist_biases) {
      counts.set(bias.bias_type, (counts.get(bias.bias_type) ?? 0) + 1);
    }
    typeCounts.set(article.outletKey, counts);
  }

  for (const entry of Array.from(result.values())) {
    entry.averageRating = entry.articleIds.length ? entry.averageRating / entry.articleIds.length : 0;
    entry.topTypes = Array.from((typeCounts.get(entry.outletKey) ?? new Map<string, number>()).entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
      .slice(0, 3);
  }
  return result;
}

/** Sentences for the swipe deck, strongest first. Quote biases only when requested. */
export function biasCards(
  input: ExploreInput,
  options: { outletKey?: string; articleId?: number; includeQuotes?: boolean } = {},
): BiasCard[] {
  const cards: BiasCard[] = [];
  for (const article of input.articles) {
    if (options.outletKey && article.outletKey !== options.outletKey) continue;
    if (options.articleId !== undefined && article.id !== options.articleId) continue;
    const analysis = input.bias[article.id];
    if (!analysis) continue;
    const sentences = options.includeQuotes
      ? [...analysis.journalist_biases, ...analysis.quote_biases]
      : analysis.journalist_biases;
    for (const sentence of sentences) {
      cards.push({ ...sentence, articleId: article.id, outletKey: article.outletKey });
    }
  }
  return cards.sort((a, b) => b.score - a.score || a.sentence_index - b.sentence_index);
}

/** Objectivity percentage as shown by BiasScoreBadge: (1 - rating) * 100. */
export function objectivity(rating: number): number {
  return Math.round((1 - Math.min(Math.max(rating, 0), 1)) * 100);
}
