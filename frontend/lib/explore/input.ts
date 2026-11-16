/**
 * Turn raw API data into the exploration input: resolved outlets, normalised article URLs and
 * a lookup that maps the (LLM) URLs in insights back to articles and outlets.
 */

import type { AggregationResponse, ArticleBiasAnalysis, EventDocument, EventEntity, EventRelation } from "@/lib/types";

import { findOutletByName, findOutletByUrl } from "./media-landscape";
import { normalizeUrl, slugify, urlFingerprint, urlHost } from "./normalize";
import { splitLlmSummary } from "./summary";
import type {
  ArticleCopy,
  ArticleDigest,
  ExploreArticle,
  ExploreAvailability,
  ExploreInput,
  ExploreOutlet,
  FoundVoice,
  HeadlineChange,
  OutletProfile,
  SponsoredStudy,
} from "./types";

export interface RawExploreArticle {
  id: number;
  title: string;
  url: string;
  source_name: string | null;
  published_at: string | null;
  is_international: boolean | null;
  source_country: string | null;
  /** source_metadata.spectrum: 0..10, "alternative" or null */
  spectrum: number | string | null;
  /** source_metadata.digest: Dutch gist of a foreign article, written by the backend job */
  digest?: { nl?: unknown; basis?: unknown } | null;
  /** source_metadata.links: pages of other sites the article text links to */
  links?: unknown;
  /** source_metadata.title_history: earlier headlines (Story 14.32) */
  title_history?: unknown;
  /** source_metadata.sponsored: studies whose sponsor the text names (Story 14.36) */
  sponsored?: unknown;
  /** event_articles.scoring_breakdown.found_voice: added for a missing voice (AI search, approved) */
  found?: { perspective?: unknown; who?: unknown; gist?: unknown; gap_key?: unknown } | null;
  /** event_articles.scoring_breakdown.copy: the same text as other articles (Story 14.27) */
  copy?: {
    group?: unknown;
    share?: unknown;
    match?: unknown;
    probability?: unknown;
    source?: unknown;
    agency?: unknown;
    likely_agency?: unknown;
    publisher?: unknown;
  } | null;
}

export interface RawExploration {
  event: {
    id: number;
    slug: string | null;
    event_type: string | null;
    article_count: number | null;
    first_seen_at: string | null;
    last_updated_at: string | null;
    archived_at: string | null;
  };
  articles: RawExploreArticle[];
  insight: AggregationResponse | null;
  entities: EventEntity[];
  relations: EventRelation[];
  /** Government and party documents about this news (Story 14.29) */
  documents?: EventDocument[];
  bias: ArticleBiasAnalysis[];
  availability: ExploreAvailability;
}

function parseSpectrum(value: number | string | null | undefined): number | "alternative" | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value.trim().toLowerCase() === "alternative" || value.trim().toLowerCase() === "alternatief") {
    return "alternative";
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDigest(value: RawExploreArticle["digest"]): ArticleDigest | null {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.nl === "string" ? value.nl.trim() : "";
  return text ? { text, basis: value.basis === "title" ? "title" : "text" } : null;
}

function parseLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((link): link is string => typeof link === "string" && /^https?:\/\//.test(link)).slice(0, 20);
}

function parseTitleHistory(value: unknown): HeadlineChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const title = text((entry as { title?: unknown }).title, 512);
    const until = text((entry as { until?: unknown }).until, 40);
    return title && until && !Number.isNaN(Date.parse(until)) ? [{ title, until }] : [];
  });
}

function parseSponsored(value: unknown): SponsoredStudy[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as { sponsor?: unknown; researcher?: unknown; sentence?: unknown; self?: unknown };
    const sponsor = text(raw.sponsor, 120);
    const sentence = text(raw.sentence, 300);
    return sponsor && sentence ? [{ sponsor, researcher: text(raw.researcher, 120), sentence, self: raw.self === true }] : [];
  }).slice(0, 3);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function parseFoundVoice(value: RawExploreArticle["found"]): FoundVoice | null {
  if (!value || typeof value !== "object") return null;
  const perspective = text(value.perspective, 200);
  if (!perspective) return null;
  const gapKey = text(value.gap_key, 80);
  return {
    perspective,
    who: text(value.who, 160),
    gist: text(value.gist, 600),
    gapKey: gapKey && /^(gap|own):[\w-]+$/.test(gapKey) ? gapKey : null,
  };
}

function share(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

function parseCopy(value: RawExploreArticle["copy"]): ArticleCopy | null {
  if (!value || typeof value !== "object") return null;
  const { group, match } = value;
  const part = share(value.share);
  const probability = share(value.probability);
  if (!Number.isInteger(group) || !Number.isInteger(match) || part === null || probability === null) return null;
  return {
    group: group as number,
    share: part,
    match: match as number,
    probability,
    source: value.source === "persbureau" || value.source === "uitgever" ? value.source : null,
    agency: text(value.agency, 40),
    likelyAgency: text(value.likely_agency, 40),
    publisher: text(value.publisher, 120),
  };
}

function resolveProfile(article: RawExploreArticle): OutletProfile | null {
  if (article.is_international) {
    return findOutletByUrl(article.url) ?? findOutletByName(article.source_name);
  }
  return findOutletByName(article.source_name) ?? findOutletByUrl(article.url);
}

export function buildExploreInput(raw: RawExploration): ExploreInput {
  const outlets = new Map<string, ExploreOutlet>();
  const articles: ExploreArticle[] = [];

  const sortedArticles = [...raw.articles].sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : Number.POSITIVE_INFINITY;
    const tb = b.published_at ? Date.parse(b.published_at) : Number.POSITIVE_INFINITY;
    return ta - tb || a.id - b.id;
  });

  for (const rawArticle of sortedArticles) {
    const profile = resolveProfile(rawArticle);
    const name = profile?.name ?? rawArticle.source_name ?? (urlHost(rawArticle.url) || "Onbekende bron");
    const key = profile?.key ?? (slugify(name) || `bron-${rawArticle.id}`);
    const isInternational = Boolean(rawArticle.is_international);
    const spectrum = parseSpectrum(rawArticle.spectrum) ?? profile?.spectrum ?? null;

    let outlet = outlets.get(key);
    if (!outlet) {
      outlet = {
        key,
        name,
        domain: profile?.domains[0] ?? (urlHost(rawArticle.url) || null),
        isInternational,
        country: rawArticle.source_country ?? profile?.country ?? (isInternational ? null : "NL"),
        spectrum: typeof spectrum === "number" ? spectrum : null,
        isAlternative: spectrum === "alternative",
        x: typeof spectrum === "number" ? spectrum : (profile?.politicalX ?? null),
        establishment: isInternational ? null : (profile?.establishment ?? null),
        articleIds: [],
        firstPublishedAt: rawArticle.published_at ?? null,
        profile,
      };
      outlets.set(key, outlet);
    }
    outlet.articleIds.push(rawArticle.id);
    const foundVoice = parseFoundVoice(rawArticle.found);
    if (foundVoice) outlet.foundVoice = true;

    articles.push({
      id: rawArticle.id,
      title: rawArticle.title,
      url: rawArticle.url,
      urlKey: normalizeUrl(rawArticle.url),
      fingerprint: urlFingerprint(rawArticle.url),
      outletKey: key,
      outletName: name,
      publishedAt: rawArticle.published_at ?? null,
      isInternational,
      sourceCountry: rawArticle.source_country ?? null,
      digest: parseDigest(rawArticle.digest),
      foundVoice,
      copy: parseCopy(rawArticle.copy),
      links: parseLinks(rawArticle.links),
      titleHistory: parseTitleHistory(rawArticle.title_history),
      sponsored: parseSponsored(rawArticle.sponsored),
    });
  }

  const bias: Record<number, ArticleBiasAnalysis> = {};
  for (const analysis of raw.bias) {
    const existing = bias[analysis.article_id];
    if (!existing || Date.parse(analysis.analyzed_at) > Date.parse(existing.analyzed_at)) {
      bias[analysis.article_id] = analysis;
    }
  }

  const summary = splitLlmSummary(raw.insight?.summary);

  return {
    event: {
      id: raw.event.id,
      slug: raw.event.slug,
      title: summary.title ?? `Event #${raw.event.id}`,
      eventType: raw.event.event_type,
      articleCount: raw.event.article_count ?? articles.length,
      firstSeenAt: raw.event.first_seen_at,
      lastUpdatedAt: raw.event.last_updated_at,
      archived: Boolean(raw.event.archived_at),
      isDemo: raw.event.id < 0,
    },
    summary,
    articles,
    outlets: Array.from(outlets.values()),
    insight: raw.insight,
    entities: raw.entities,
    relations: raw.relations,
    documents: raw.documents ?? [],
    bias,
    availability: raw.availability,
  };
}

export interface ResolvedUrl {
  article: ExploreArticle | null;
  outletKey: string | null;
}

/** Maps URLs from insights (and outlet names from the LLM) back to articles and outlets. */
export class ArticleIndex {
  private byKey = new Map<string, ExploreArticle>();
  private byFingerprint = new Map<string, ExploreArticle[]>();
  private byId = new Map<number, ExploreArticle>();
  private outletByKey = new Map<string, ExploreOutlet>();
  private outletByDomain = new Map<string, string>();
  private outletByName = new Map<string, string>();

  constructor(input: ExploreInput) {
    for (const article of input.articles) {
      this.byKey.set(article.urlKey, article);
      this.byId.set(article.id, article);
      const list = this.byFingerprint.get(article.fingerprint) ?? [];
      list.push(article);
      this.byFingerprint.set(article.fingerprint, list);
      const host = urlHost(article.url);
      if (host && !this.outletByDomain.has(host)) {
        this.outletByDomain.set(host, article.outletKey);
      }
    }
    for (const outlet of input.outlets) {
      this.outletByKey.set(outlet.key, outlet);
      this.outletByName.set(slugify(outlet.name), outlet.key);
      for (const alias of outlet.profile?.aliases ?? []) {
        this.outletByName.set(slugify(alias), outlet.key);
      }
      for (const domain of outlet.profile?.domains ?? []) {
        this.outletByDomain.set(domain, outlet.key);
      }
    }
  }

  article(id: number): ExploreArticle | null {
    return this.byId.get(id) ?? null;
  }

  outlet(key: string | null | undefined): ExploreOutlet | null {
    return key ? (this.outletByKey.get(key) ?? null) : null;
  }

  /** Resolve an insight URL: exact normalised match, then a unique fingerprint match, then the host. */
  resolveUrl(url: string | null | undefined): ResolvedUrl {
    if (!url) return { article: null, outletKey: null };
    const exact = this.byKey.get(normalizeUrl(url));
    if (exact) return { article: exact, outletKey: exact.outletKey };
    const candidates = this.byFingerprint.get(urlFingerprint(url));
    if (candidates && candidates.length === 1) {
      return { article: candidates[0], outletKey: candidates[0].outletKey };
    }
    const host = urlHost(url);
    const fromHost = this.outletByDomain.get(host);
    if (fromHost) return { article: null, outletKey: fromHost };
    const profile = findOutletByUrl(url);
    if (profile && this.outletByKey.has(profile.key)) {
      return { article: null, outletKey: profile.key };
    }
    return { article: null, outletKey: null };
  }

  /** Outlet keys for a list of insight URLs (deduplicated, in order). */
  outletsForUrls(urls: (string | null | undefined)[] | null | undefined): string[] {
    const keys: string[] = [];
    for (const url of urls ?? []) {
      const { outletKey } = this.resolveUrl(url);
      if (outletKey && !keys.includes(outletKey)) {
        keys.push(outletKey);
      }
    }
    return keys;
  }

  /** Outlet key for a name the LLM used (media_analysis.source), falling back to an article URL. */
  outletForName(name: string | null | undefined, articleUrl?: string | null): string | null {
    if (articleUrl) {
      const { outletKey } = this.resolveUrl(articleUrl);
      if (outletKey) return outletKey;
    }
    if (!name) return null;
    const direct = this.outletByName.get(slugify(name));
    if (direct) return direct;
    const profile = findOutletByName(name);
    return profile && this.outletByKey.has(profile.key) ? profile.key : null;
  }
}
