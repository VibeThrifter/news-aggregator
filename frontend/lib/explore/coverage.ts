/**
 * "Wie schreef erover?": the articles that mention an entity, per outlet. Pure (no data access).
 */

import type { ArticleRef, EntityArticleGroup } from "@/lib/types";

import { slugify } from "./normalize";
import { wikiTitleCandidates } from "./wikipedia";

/** Aliases to find a propaganda-model name among the news entities: "AD (Algemeen Dagblad)" → ad-algemeen-dagblad, algemeen-dagblad, ad. */
export function nameAliases(name: string): string[] {
  return Array.from(new Set(wikiTitleCandidates(name).map(slugify).filter(Boolean)));
}

export interface OutletCoverage {
  name: string;
  /** Distinct articles */
  count: number;
  /** Newest first, each with the news item it belongs to */
  articles: ArticleRef[];
}

const newestFirst = (a: ArticleRef, b: ArticleRef) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? ""));

/** Group the articles of the news items an entity appears in by outlet: most articles first, then by name. */
export function coverageByOutlet(groups: EntityArticleGroup[]): OutletCoverage[] {
  const byOutlet = new Map<string, Map<number, ArticleRef>>();
  for (const group of groups) {
    for (const article of group.articles) {
      const name = article.source_name?.trim() || "Onbekend";
      const articles = byOutlet.get(name) ?? new Map<number, ArticleRef>();
      if (!articles.has(article.id)) {
        articles.set(article.id, {
          ...article,
          event_id: article.event_id ?? group.event_id,
          event_slug: article.event_slug ?? group.event_slug,
          event_title: article.event_title ?? group.event_title,
        });
      }
      byOutlet.set(name, articles);
    }
  }
  return Array.from(byOutlet.entries())
    .map(([name, articles]) => ({ name, count: articles.size, articles: Array.from(articles.values()).sort(newestFirst) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "nl"));
}
