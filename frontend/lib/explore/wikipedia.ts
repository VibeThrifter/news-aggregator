/**
 * Parsing of Wikipedia REST responses (the fetching lives in lib/api.ts).
 * Only plain-text extracts are used, never extract_html.
 */

import { slugify } from "./normalize";

export interface WikiSummary {
  lang: string;
  title: string;
  description: string | null;
  extract: string;
  thumbnail: string | null;
  url: string;
  disambiguation: boolean;
}

export interface WikiCandidate {
  title: string;
  description: string | null;
  url: string;
}

export function wikiSummaryUrl(title: string, lang = "nl"): string {
  return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/ /g, "_"))}`;
}

export function wikiSearchUrl(query: string, lang = "nl"): string {
  const params = new URLSearchParams({
    action: "opensearch",
    search: query,
    limit: "5",
    namespace: "0",
    format: "json",
    origin: "*",
  });
  return `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
}

export function parseWikiSummary(json: unknown, lang = "nl"): WikiSummary | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, any>;
  if (typeof data.title !== "string" || typeof data.extract !== "string") return null;
  const url =
    data.content_urls?.mobile?.page ??
    data.content_urls?.desktop?.page ??
    `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(data.title).replace(/ /g, "_"))}`;
  return {
    lang,
    title: data.title,
    description: typeof data.description === "string" ? data.description : null,
    extract: data.extract,
    thumbnail: typeof data.thumbnail?.source === "string" ? data.thumbnail.source : null,
    url,
    disambiguation: data.type === "disambiguation",
  };
}

/** Opensearch returns [query, titles[], descriptions[], urls[]]. */
export function parseWikiSearch(json: unknown): WikiCandidate[] {
  if (!Array.isArray(json) || json.length < 4) return [];
  const [, titles, descriptions, urls] = json as [string, string[], string[], string[]];
  if (!Array.isArray(titles)) return [];
  return titles.map((title, i) => ({
    title,
    description: descriptions?.[i] || null,
    url: urls?.[i] ?? `https://nl.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  }));
}

/**
 * Titles to try for a name, most specific first:
 * "AD (Algemeen Dagblad)" -> ["AD (Algemeen Dagblad)", "Algemeen Dagblad", "AD"].
 */
export function wikiTitleCandidates(name: string): string[] {
  const clean = name.replace(/\s+/g, " ").trim();
  const titles = [clean];
  const paren = clean.match(/^(.*?)\s*\((.+)\)$/);
  if (paren) titles.push(paren[2].trim(), paren[1].trim());
  return Array.from(new Set(titles.filter((title) => title.length >= 2))).slice(0, 3);
}

/** A search hit is the same thing when its title (without a "(…)" qualifier) equals the name. */
export function isSameTitle(title: string, name: string): boolean {
  const norm = (value: string) => slugify(value.replace(/\(.*?\)/g, " "));
  return norm(title) !== "" && norm(title) === norm(name);
}

export function wikiSearchPageUrl(query: string, lang = "nl"): string {
  return `https://${lang}.wikipedia.org/w/index.php?${new URLSearchParams({ search: query, ns0: "1" }).toString()}`;
}
