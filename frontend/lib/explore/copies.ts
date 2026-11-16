/**
 * Zelfde tekst (Story 14.27): the articles of the news that are one text — agency copy, or one
 * article of a publisher in several of its titles. The backend compares the texts (job "Copy
 * Detection", no AI) and stores per article its group; this puts the groups together for the page.
 */

import type { ArticleCopy, CopyGroup, ExploreArticle } from "./types";

export type { CopyGroup, CopyGroupArticle } from "./types";

function publishedTime(article: ExploreArticle): number {
  const time = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

/** The groups of articles with the same text, the biggest first; a group needs two outlets. */
export function copyGroups(articles: ExploreArticle[]): CopyGroup[] {
  const byGroup = new Map<number, ExploreArticle[]>();
  for (const article of articles) {
    if (!article.copy) continue;
    byGroup.set(article.copy.group, [...(byGroup.get(article.copy.group) ?? []), article]);
  }
  const groups: CopyGroup[] = [];
  byGroup.forEach((members, key) => {
    members.sort((a, b) => publishedTime(a) - publishedTime(b) || a.id - b.id);
    const outletKeys = Array.from(new Set(members.map((article) => article.outletKey)));
    if (members.length < 2 || outletKeys.length < 2) return;
    const copy = (members.find((article) => article.id === key) ?? members[0]).copy as ArticleCopy;
    groups.push({
      key,
      source: copy.source,
      agency: copy.agency,
      likelyAgency: copy.likelyAgency,
      publisher: copy.publisher,
      articles: members.map((article) => ({
        article,
        share: article.copy?.share ?? 0,
        probability: article.copy?.probability ?? 0,
      })),
      outletKeys,
    });
  });
  return groups.sort((a, b) => b.articles.length - a.articles.length || a.key - b.key);
}

/** Where the one text comes from, as the heading of its group. */
export function copyGroupLabel(group: Pick<CopyGroup, "source" | "agency" | "likelyAgency" | "publisher">): string {
  if (group.source === "persbureau") {
    if (group.agency) return `Zelfde ${group.agency}-tekst`;
    return group.likelyAgency ? `Zelfde persbureautekst (vermoedelijk ${group.likelyAgency})` : "Zelfde persbureautekst";
  }
  if (group.source === "uitgever") {
    return group.publisher ? `Zelfde artikel van ${group.publisher}` : "Zelfde artikel in meer titels";
  }
  // Titles of one owner: they take agency copy too, so it can be either
  return group.publisher ? `Zelfde tekst bij titels van ${group.publisher}` : "Zelfde tekst";
}

/**
 * Where it comes from in a word, on the line between the balloons: "ANP" only when a text names it
 * ("vermoedelijk" does not fit on a line), the publisher of its own article, else nothing.
 */
export function copyShortLabel(group: Pick<CopyGroup, "source" | "agency" | "publisher">): string {
  if (group.source === "persbureau") return group.agency ?? "persbureau";
  if (group.source === "uitgever" && group.publisher) return group.publisher;
  return "zelfde tekst";
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** "92% dezelfde tekst"; an article that is mostly something else (a liveblog) "bevat deze tekst". */
export function shareLabel(share: number): string {
  return share < 0.25 ? "bevat deze tekst" : `${percent(share)} dezelfde tekst`;
}

/** "kans 87%"; never 100%: it is a measure, not a certainty. */
export function chanceLabel(probability: number): string {
  return `kans ${Math.min(99, Math.round(probability * 100))}%`;
}
