/**
 * Links in the article texts: the pages outlets rest on. A page that articles of more than one
 * outlet link to is a source they share (a ministry letter, a report, one post on X).
 */

import { urlHost } from "./normalize";
import type { ExploreArticle } from "./types";

export interface SharedLink {
  url: string;
  host: string;
  /** Outlets that link to it, in the order of their first article */
  outletKeys: string[];
}

/** Pages linked by articles of at least two outlets, the most outlets first. */
export function sharedLinks(articles: ExploreArticle[]): SharedLink[] {
  const byUrl = new Map<string, SharedLink>();
  for (const article of articles) {
    for (const url of article.links ?? []) {
      const link = byUrl.get(url) ?? { url, host: linkHost(url), outletKeys: [] };
      if (!link.outletKeys.includes(article.outletKey)) link.outletKeys.push(article.outletKey);
      byUrl.set(url, link);
    }
  }
  return [...byUrl.values()]
    .filter((link) => link.outletKeys.length >= 2)
    .sort((a, b) => b.outletKeys.length - a.outletKeys.length);
}

/** The outlets whose articles link to this page, in the order of their first article */
export function outletsLinking(articles: ExploreArticle[], url: string): string[] {
  const names: string[] = [];
  for (const article of articles) {
    if (article.links?.includes(url) && !names.includes(article.outletName)) names.push(article.outletName);
  }
  return names;
}

/** The site of a link as a reader knows it: rijksoverheid.nl, x.com */
export function linkHost(url: string): string {
  return urlHost(url).replace(/^www\./, "");
}
