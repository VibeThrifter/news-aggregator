import type {
  AggregationResponse,
  ArticleBiasAnalysis,
  EntityAppearance,
  EntityCooccurrence,
  EntityResearch,
  EntityResearchKind,
  EntityResearchRequest,
  EventArticle,
  EventDetail,
  EventEntity,
  EventRelation,
  ArticleRef,
  ArticleSearchResult,
  EntityArticleGroup,
  PmArgument,
  PmDetails,
  PmEntity,
  PmMatch,
  PmMeta,
  PmNeighborhood,
  PmPaths,
  RelationResearch,
  EventDetailMeta,
  EventFeedMeta,
  EventListItem,
  EventSourceBreakdownEntry,
  SpectrumDistribution,
} from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import type { RawExploration, RawExploreArticle } from "@/lib/explore/input";
import { filterNeighborhood } from "@/lib/explore/pm-graph";
import { stripMarkdown } from "@/lib/explore/summary";
import { createLocalPm, extendSlice, type PmSlice } from "@/lib/explore/pm-local";
import {
  parseWikiSearch,
  parseWikiSummary,
  wikiSearchUrl,
  wikiSummaryUrl,
  type WikiCandidate,
  type WikiSummary,
} from "@/lib/explore/wikipedia";

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly payload?: ApiErrorPayload;

  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.payload = payload;
  }
}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
  links?: Record<string, string>;
}

export interface EventListFilters {
  /** Start date for filtering (YYYY-MM-DD format) */
  startDate?: string;
  /** End date for filtering (YYYY-MM-DD format) */
  endDate?: string;
  category?: string;
  minSources?: number;
  search?: string;
  /** When true, ignores date filter and searches all events (with limit) */
  searchAllPeriods?: boolean;
  /** Admin mode: include events without LLM insights */
  includeWithoutInsights?: boolean;
  /** Paging of the feed: where this page starts and how many items it holds (FEED_PAGE_SIZE) */
  offset?: number;
  limit?: number;
}

/** Maximum events returned when searching all periods */
const SEARCH_ALL_LIMIT = 50;

/**
 * News items per page of the feed. A week of news from every main source is about 900 items
 * (3 MB): one query for all of it can run into the statement timeout of the website (3 s).
 */
export const FEED_PAGE_SIZE = 120;

const FALLBACK_API_BASE_URL = "http://localhost:8000";
const rawBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
export const API_BASE_URL = (rawBaseUrl && stripTrailingSlash(rawBaseUrl)) || FALLBACK_API_BASE_URL;

if (!rawBaseUrl && typeof console !== "undefined") {
  console.warn(
    "[api] NEXT_PUBLIC_API_BASE_URL ontbreekt. Valt terug op http://localhost:8000. Voeg de variabele toe in frontend/.env.local of frontend/.env voor de juiste backend-URL.",
  );
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.replace(/\/+$/, "") : url;
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalisedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${API_BASE_URL}/${normalisedPath}`;
}

export function resolveApiUrl(path: string): string {
  return buildUrl(path);
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw new ApiClientError("Kon JSON-respons niet parsen", response.status, {
      code: "INVALID_JSON",
      message: "Response kon niet als JSON worden gelezen",
      details: { raw: text },
    });
  }
}

function resolveErrorPayload(body: unknown, response: Response): ApiErrorPayload {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object"
  ) {
    const payload = body.error as Partial<ApiErrorPayload>;
    return {
      code: payload.code ?? "HTTP_ERROR",
      message: payload.message ?? response.statusText,
      details: payload.details,
    };
  }

  return {
    code: "HTTP_ERROR",
    message: response.statusText || "Onbekende fout",
    details: body,
  };
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiFetchOptions = Omit<RequestInit, "method" | "body"> & {
  method?: HttpMethod;
  body?: BodyInit | null;
  next?: Record<string, unknown>;
};

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<ApiResponse<T>> {
  const { method = "GET", headers, body, ...rest } = options;

  const requestHeaders = new Headers({ Accept: "application/json" });

  if (headers) {
    const additionalHeaders = headers instanceof Headers ? headers : new Headers(headers);
    additionalHeaders.forEach((value, key) => {
      requestHeaders.set(key, value);
    });
  }

  if (typeof body === "string" && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(buildUrl(path), {
    ...rest,
    method,
    headers: requestHeaders,
    body,
  });

  const contentType = response.headers.get("content-type");
  const expectsJson = contentType?.includes("application/json");

  if (!response.ok) {
    const parsed = expectsJson ? await parseJson(response).catch(() => null) : null;
    const payload = resolveErrorPayload(parsed, response);

    throw new ApiClientError(payload.message, response.status, payload);
  }

  if (!expectsJson) {
    throw new ApiClientError("API antwoordde niet met JSON", response.status, {
      code: "UNEXPECTED_CONTENT_TYPE",
      message: "Er werd JSON verwacht maar content-type week af",
      details: { contentType },
    });
  }

  const bodyJson = await parseJson(response);

  if (!bodyJson || typeof bodyJson !== "object" || !("data" in bodyJson)) {
    throw new ApiClientError("API-respons bevat geen data-veld", response.status, {
      code: "INVALID_SCHEMA",
      message: "Respons volgt niet het JSON:API-lite schema",
      details: bodyJson,
    });
  }

  return bodyJson as ApiResponse<T>;
}

export const ApiClient = {
  get<T>(path: string, options?: ApiFetchOptions) {
    return apiFetch<T>(path, { ...options, method: "GET" });
  },
  post<T>(path: string, body?: unknown, options?: ApiFetchOptions) {
    return apiFetch<T>(path, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  },
};

const MAX_TITLE_LENGTH = 60;

function extractTitleFromSummary(
  summary: string | null | undefined,
  options?: { truncate?: boolean }
): { title: string | null; description: string | null } {
  if (!summary) {
    return { title: null, description: null };
  }

  // LLM summaries have format: "Title\n\nContent..." where title has no punctuation
  // First try to match title followed by blank line
  const blankLineMatch = summary.match(/^([^\n]+)\n\n(.*)$/s);
  let title: string;
  let rest: string | null;

  if (blankLineMatch) {
    // Title is first line before blank line
    title = blankLineMatch[1].trim();
    rest = blankLineMatch[2].trim() || null;
  } else {
    // Fallback: split on first sentence ending (. ! ?)
    const sentenceMatch = summary.match(/^(.+?[.!?])\s*(.*)$/s);
    if (sentenceMatch) {
      title = sentenceMatch[1].trim();
      rest = sentenceMatch[2].trim() || null;
    } else {
      title = summary;
      rest = null;
    }
  }

  // The LLM sometimes puts the title in bold ("**Titel**")
  title = stripMarkdown(title);

  // Truncate long titles (only for card views, not detail pages)
  if (options?.truncate !== false && title.length > MAX_TITLE_LENGTH) {
    // Try to break at a word boundary
    const truncated = title.slice(0, MAX_TITLE_LENGTH);
    const lastSpace = truncated.lastIndexOf(' ');
    title = lastSpace > 40 ? truncated.slice(0, lastSpace) + '…' : truncated + '…';
  }

  return { title, description: rest };
}

export async function listEvents(
  filters?: EventListFilters,
  options?: ApiFetchOptions
): Promise<ApiResponse<EventListItem[]>> {
  const { startDate, endDate, category, minSources = 1, search, searchAllPeriods = false, includeWithoutInsights = false } = filters ?? {};

  // Main sources: a news item is only shown with at least one article of an enabled main source.
  // - No sources configured at all (fresh system): show every news item.
  // - Sources configured but no main source enabled: show nothing.
  const [{ data: allSources }, { data: enabledMainSources }] = await Promise.all([
    getSupabase().from('news_sources').select('id').limit(1),
    getSupabase().from('news_sources').select('display_name').eq('is_main_source', true).eq('enabled', true),
  ]);
  const hasAnySourcesConfigured = (allSources || []).length > 0;
  const mainSourceNames = (enabledMainSources || []).map((s: { display_name: string }) => s.display_name);
  if (hasAnySourcesConfigured && mainSourceNames.length === 0) {
    return { data: [] };
  }

  // Build query with server-side filters
  // By default, only show events with LLM insights (to avoid showing article titles which is copyright)
  // Admin mode (includeWithoutInsights) shows all events
  // INFRA Story 3: Select only needed fields to reduce Supabase egress
  // Previously used * which fetched unused fields like centroid_embedding, centroid_tfidf, description
  let query = getSupabase()
    .from('events')
    .select(`
      id,
      slug,
      title,
      event_type,
      article_count,
      first_seen_at,
      last_updated_at,
      spectrum_distribution,
      archived_at,
      llm_insights${includeWithoutInsights ? '' : '!inner'} (
        summary,
        gap0:coverage_gaps->0->>perspective,
        gap1:coverage_gaps->1->>perspective,
        gap2:coverage_gaps->2->>perspective,
        gap3:coverage_gaps->3->>perspective,
        gap4:coverage_gaps->4->>perspective,
        gap5:coverage_gaps->5->>perspective
      ),
      ${hasAnySourcesConfigured ? 'main:event_articles!inner ( articles!inner ( source_name ) ),' : ''}
      event_articles (
        articles (
          source_name,
          spectrum:source_metadata->spectrum,
          image_url,
          published_at,
          is_international
        )
      )
    `)
    .is('archived_at', null)
    // One analysis per event: the newest, as on the event page. A new analysis by another
    // provider adds a row next to the old one (one row per event and provider).
    .order('generated_at', { referencedTable: 'llm_insights', ascending: false })
    .limit(1, { referencedTable: 'llm_insights' });

  // The main sources filter in the database ("main" is the same join, only for this filter; the
  // event_articles above keep every outlet). Filtering here instead of afterwards fetched up to
  // 1000 news items (3 MB) to show fewer than 100, and the query ran into the statement timeout.
  if (hasAnySourcesConfigured) {
    query = query.in('main.articles.source_name', mainSourceNames);
  }

  // Apply date range filter unless searching all periods
  if (!searchAllPeriods) {
    if (startDate) {
      // Start of day in UTC
      query = query.gte('last_updated_at', `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      // End of day in UTC (23:59:59.999)
      query = query.lte('last_updated_at', `${endDate}T23:59:59.999Z`);
    }
  }

  // Filter by category (event_type)
  if (category && category !== 'all') {
    query = query.eq('event_type', category);
  }

  // Filter by minimum sources (article_count)
  if (minSources > 1) {
    query = query.gte('article_count', minSources);
  }

  // Search in title using case-insensitive pattern match
  if (search?.trim()) {
    query = query.ilike('title', `%${search.trim()}%`);
  }

  // Newest news first, by when it started: the backend also moves last_updated_at when it touches an
  // old event (maintenance, a new analysis), which put old news on the first page. All-periods search
  // has a limit, the feed comes in pages.
  query = query.order('first_seen_at', { ascending: false });
  const offset = filters?.offset ?? 0;
  const pageSize = filters?.limit ?? FEED_PAGE_SIZE;
  if (searchAllPeriods) {
    query = query.limit(SEARCH_ALL_LIMIT);
  } else {
    query = query.range(offset, offset + pageSize - 1);
  }

  const { data, error } = await query;

  if (error) {
    throw new ApiClientError(error.message, 500, {
      code: 'SUPABASE_ERROR',
      message: error.message,
      details: error,
    });
  }

  const events: EventListItem[] = (data || []).map((event: any) => {
    // llm_insights is an array from Supabase join (the newest analysis only, see the query)
    const insight = event.llm_insights?.[0];
    const insightSummary = insight?.summary;
    const { title: llmTitle, description: llmDescription } = extractTitleFromSummary(insightSummary);
    // "Niet aan het woord": the missing voices of the analysis (JSON paths, a few bytes each; hardly
    // any analysis has more than six)
    const missingVoices = [insight?.gap0, insight?.gap1, insight?.gap2, insight?.gap3, insight?.gap4, insight?.gap5].filter(
      (voice: unknown): voice is string => typeof voice === "string" && voice.trim().length > 0,
    );

    // Build source_breakdown from event_articles and find first image + latest article date
    const sourceBreakdownMap = new Map<string, { source: string; article_count: number; spectrum: string | number | null; is_international: boolean }>();
    let featured_image_url: string | null = null;
    let latestArticleDate: Date | null = null;
    // When Dutch media last wrote about it: Google News finds foreign articles days later
    let latestDutchDate: Date | null = null;
    for (const ea of event.event_articles || []) {
      const article = ea.articles;
      if (!article) continue;
      const source = article.source_name || 'Unknown';
      // Only the spectrum of the metadata (the whole object made the list a quarter heavier)
      const spectrum = article.spectrum || null;
      const isInternational = article.is_international || false;
      const key = `${source}|${spectrum || ''}|${isInternational}`;
      const existing = sourceBreakdownMap.get(key);
      if (existing) {
        existing.article_count++;
      } else {
        sourceBreakdownMap.set(key, { source, article_count: 1, spectrum, is_international: isInternational });
      }
      // Get first available image URL
      if (!featured_image_url && article.image_url) {
        featured_image_url = article.image_url;
      }
      // Track latest article publication date
      if (article.published_at) {
        const pubDate = new Date(article.published_at);
        if (!latestArticleDate || pubDate > latestArticleDate) {
          latestArticleDate = pubDate;
        }
        if (!isInternational && (!latestDutchDate || pubDate > latestDutchDate)) {
          latestDutchDate = pubDate;
        }
      }
    }
    const source_breakdown: EventSourceBreakdownEntry[] = Array.from(sourceBreakdownMap.values());
    // The time of the news: the latest Dutch article, else the latest article, else the event's timestamp
    const computedLastUpdated = (latestDutchDate ?? latestArticleDate)?.toISOString() || event.last_updated_at;

    return {
      id: event.id,
      slug: event.slug,
      // ONLY use LLM-generated title - NEVER fall back to event.title (which is article title = copyright)
      title: llmTitle || `Event #${event.id}`,
      // Use LLM description (rest of summary), or null if no LLM insights
      description: llmDescription,
      summary: insightSummary,
      // Flag to indicate if this event has LLM-generated content
      has_llm_insights: !!insightSummary,
      article_count: event.article_count || 0,
      first_seen_at: event.first_seen_at,
      last_updated_at: computedLastUpdated,
      spectrum_distribution: event.spectrum_distribution,
      source_breakdown,
      event_type: event.event_type || null,
      featured_image_url,
      missing_voices: missingVoices,
    };
  });

  // The date range is about the news itself. The query filters on the event's own timestamp, which
  // the backend also moves when it touches an old event (maintenance, a new analysis).
  const inRange =
    searchAllPeriods || !startDate
      ? events
      : events.filter((event) => !event.last_updated_at || event.last_updated_at >= `${startDate}T00:00:00.000Z`);

  // A full page means there may be more (counted before the range filter above)
  const received = (data || []).length;
  return {
    data: inRange,
    meta: { has_more: !searchAllPeriods && received === pageSize, next_offset: offset + received },
  };
}

function encodeEventIdentifier(id: string | number): string {
  if (typeof id === "number") {
    return encodeURIComponent(String(id));
  }
  return encodeURIComponent(id);
}

export async function getEventDetail(eventId: string | number, options?: ApiFetchOptions): Promise<ApiResponse<EventDetail>> {
  // Fetch event - check if eventId is numeric or a slug
  const isNumeric = typeof eventId === 'number' || !isNaN(Number(eventId));
  // Epic 11 Story 11.1: explicit columns only. select('*') also pulled centroid_embedding,
  // centroid_tfidf and centroid_entities, which the page never uses (Supabase egress).
  const query = getSupabase()
    .from('events')
    .select('id, slug, event_type, article_count, first_seen_at, last_updated_at, spectrum_distribution');

  const { data: event, error: eventError } = await (isNumeric
    ? query.eq('id', Number(eventId))
    : query.eq('slug', eventId)
  ).single();

  if (eventError || !event) {
    throw new ApiClientError(eventError?.message || 'Event not found', 404, {
      code: 'NOT_FOUND',
      message: 'Event not found',
    });
  }

  // Fetch articles for this event
  // INFRA Story 2: Select only needed fields to reduce Supabase egress
  // Previously used articles (*) which fetched unused fields like content, embedding, tfidf_vector
  const { data: eventArticles, error: articlesError } = await getSupabase()
    .from('event_articles')
    .select(`
      article_id,
      similarity_score,
      articles (
        id,
        title,
        url,
        source_name,
        summary,
        published_at,
        image_url,
        source_metadata,
        is_international,
        source_country
      )
    `)
    .eq('event_id', event.id);

  if (articlesError) {
    throw new ApiClientError(articlesError.message, 500, {
      code: 'SUPABASE_ERROR',
      message: articlesError.message,
    });
  }

  const articles: EventArticle[] = (eventArticles || []).map((ea: any) => ({
    id: ea.articles.id,
    title: ea.articles.title,
    url: ea.articles.url,
    source: ea.articles.source_name || 'Unknown',
    spectrum: ea.articles.source_metadata?.spectrum || null,
    summary: ea.articles.summary,
    published_at: ea.articles.published_at,
    image_url: ea.articles.image_url,
    is_international: ea.articles.is_international || false,
    source_country: ea.articles.source_country || null,
  }));

  // Build source_breakdown from articles and find latest article date
  const sourceBreakdownMap = new Map<string, { source: string; article_count: number; spectrum: string | number | null; is_international: boolean }>();
  let latestArticleDate: Date | null = null;
  for (const article of articles) {
    const isInternational = article.is_international || false;
    const key = `${article.source}|${article.spectrum || ''}|${isInternational}`;
    const existing = sourceBreakdownMap.get(key);
    if (existing) {
      existing.article_count++;
    } else {
      sourceBreakdownMap.set(key, {
        source: article.source,
        article_count: 1,
        spectrum: article.spectrum || null,
        is_international: isInternational,
      });
    }
    // Track latest article publication date
    if (article.published_at) {
      const pubDate = new Date(article.published_at);
      if (!latestArticleDate || pubDate > latestArticleDate) {
        latestArticleDate = pubDate;
      }
    }
  }
  const source_breakdown: EventSourceBreakdownEntry[] = Array.from(sourceBreakdownMap.values());
  // Use latest article date as last_updated_at, fallback to event's timestamp
  const computedLastUpdated = latestArticleDate?.toISOString() || event.last_updated_at;

  // Fetch LLM insights to get the generated title (NOT the article title)
  // Order by id desc to get the latest insight (in case of regeneration)
  const { data: llmInsightsArr } = await getSupabase()
    .from('llm_insights')
    .select('summary')
    .eq('event_id', event.id)
    .order('id', { ascending: false })
    .limit(1);
  const llmInsights = llmInsightsArr?.[0] ?? null;

  // Don't truncate title on detail page - show full title
  const { title: llmTitle } = extractTitleFromSummary(llmInsights?.summary, { truncate: false });

  const eventDetail: EventDetail = {
    id: event.id,
    slug: event.slug,
    event_type: event.event_type || null,
    // ONLY use LLM-generated title - NEVER fall back to event.title (which is article title = copyright)
    title: llmTitle || `Event #${event.id}`,
    description: null, // Never use event.description (could be article content)
    article_count: event.article_count || 0,
    first_seen_at: event.first_seen_at,
    last_updated_at: computedLastUpdated,
    spectrum_distribution: event.spectrum_distribution,
    source_breakdown,
    articles,
  };

  return { data: eventDetail };
}

/** Columns of llm_insights used by the frontend (no raw_response/prompt_metadata: large and unused). */
const INSIGHT_COLUMNS = [
  'id',
  'provider',
  'model',
  'generated_at',
  'summary',
  'timeline',
  'clusters',
  'contradictions',
  'involved_countries',
  'fallacies',
  'frames',
  'coverage_gaps',
  'unsubstantiated_claims',
  'authority_analysis',
  'media_analysis',
  'statistical_issues',
  'timing_analysis',
  'scientific_plurality',
].join(', ');

function emptyInsights(): AggregationResponse {
  return {
    query: '',
    generated_at: new Date().toISOString(),
    summary: null,
    timeline: [],
    clusters: [],
    contradictions: [],
    fallacies: [],
    frames: [],
    coverage_gaps: [],
    unsubstantiated_claims: [],
    authority_analysis: [],
    media_analysis: [],
    statistical_issues: [],
    timing_analysis: null,
    scientific_plurality: null,
    involved_countries: [],
  };
}

/** Map an llm_insights row to the frontend insight shape. */
export function mapInsightRow(insights: any): AggregationResponse {
  return {
    query: '',
    generated_at: insights.generated_at,
    llm_provider: insights.provider,
    model: insights.model ?? null,
    summary: insights.summary,
    timeline: insights.timeline || [],
    clusters: insights.clusters || [],
    contradictions: insights.contradictions || [],
    fallacies: insights.fallacies || [],
    frames: insights.frames || [],
    coverage_gaps: insights.coverage_gaps || [],
    // Kritische analyse velden
    unsubstantiated_claims: insights.unsubstantiated_claims || [],
    authority_analysis: insights.authority_analysis || [],
    media_analysis: insights.media_analysis || [],
    // Epic 11 Story 11.1: these three were dropped before, so their sections never rendered
    statistical_issues: insights.statistical_issues || [],
    timing_analysis: insights.timing_analysis || null,
    scientific_plurality: insights.scientific_plurality || null,
    involved_countries: insights.involved_countries || [],
  };
}

export async function getEventInsights(eventId: string | number, options?: ApiFetchOptions): Promise<ApiResponse<AggregationResponse>> {
  // First, get the event to find its numeric ID if a slug was provided
  const isNumeric = typeof eventId === 'number' || !isNaN(Number(eventId));
  let numericEventId: number;

  if (isNumeric) {
    numericEventId = Number(eventId);
  } else {
    // Fetch event by slug to get numeric ID
    const { data: event } = await getSupabase()
      .from('events')
      .select('id')
      .eq('slug', eventId)
      .single();

    if (!event) {
      // Event not found, return empty insights
      return { data: emptyInsights() };
    }
    numericEventId = event.id;
  }

  // Order by id desc to get the latest insight (in case of regeneration)
  const { data: insightsArr, error } = await getSupabase()
    .from('llm_insights')
    .select(INSIGHT_COLUMNS)
    .eq('event_id', numericEventId)
    .order('id', { ascending: false })
    .limit(1);
  const insights = insightsArr?.[0] ?? null;

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    throw new ApiClientError(error.message, 500, {
      code: 'SUPABASE_ERROR',
      message: error.message,
    });
  }

  if (!insights) {
    // No insights generated yet
    return { data: emptyInsights() };
  }

  return { data: mapInsightRow(insights) };
}

export function triggerInsightsRegeneration(eventId: string | number, options?: ApiFetchOptions) {
  return ApiClient.post(`/admin/trigger/generate-insights/${encodeEventIdentifier(eventId)}`, undefined, options);
}

export function resolveEventExportUrl(eventId: string | number): string {
  return resolveApiUrl(`/api/v1/exports/events/${encodeEventIdentifier(eventId)}`);
}

// Admin API functions

export interface NewsSource {
  source_id: string;
  display_name: string;
  feed_url: string;
  spectrum: string | number | null;
  enabled: boolean;
  is_main_source: boolean;
}

export interface SourcesListResponse {
  sources: NewsSource[];
  total: number;
}

export interface SourceUpdateRequest {
  enabled?: boolean;
  is_main_source?: boolean;
}

/**
 * List all configured news sources with their settings.
 */
export async function listSources(): Promise<SourcesListResponse> {
  const response = await fetch(buildUrl('/admin/sources'), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to list sources', response.status);
  }

  return response.json();
}

/**
 * Update source settings (enabled, is_main_source).
 */
export async function updateSource(
  sourceId: string,
  update: SourceUpdateRequest
): Promise<NewsSource> {
  const response = await fetch(buildUrl(`/admin/sources/${encodeURIComponent(sourceId)}`), {
    method: 'PATCH',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to update source', response.status);
  }

  return response.json();
}

/**
 * Initialize sources from registered feed readers.
 */
export async function initializeSources(): Promise<{ message: string; stats: { created: number; existing: number; total: number } }> {
  const response = await fetch(buildUrl('/admin/sources/initialize'), {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to initialize sources', response.status);
  }

  return response.json();
}

// LLM Config API functions

export interface LlmConfig {
  id: number;
  key: string;
  value: string;
  config_type: string;
  description: string | null;
  updated_at: string;
}

export interface LlmConfigListResponse {
  configs: LlmConfig[];
  total: number;
}

export interface LlmConfigUpdateRequest {
  value: string;
  description?: string;
}

/**
 * List all LLM configuration entries.
 */
export async function listLlmConfigs(configType?: string): Promise<LlmConfigListResponse> {
  const url = configType
    ? buildUrl(`/admin/llm-config?config_type=${encodeURIComponent(configType)}`)
    : buildUrl('/admin/llm-config');

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to list LLM configs', response.status);
  }

  return response.json();
}

/**
 * Get a specific LLM config entry by key.
 */
export async function getLlmConfig(key: string): Promise<LlmConfig> {
  const response = await fetch(buildUrl(`/admin/llm-config/${encodeURIComponent(key)}`), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to get LLM config', response.status);
  }

  return response.json();
}

/**
 * Update an LLM config entry.
 */
export async function updateLlmConfig(
  key: string,
  update: LlmConfigUpdateRequest
): Promise<LlmConfig> {
  const response = await fetch(buildUrl(`/admin/llm-config/${encodeURIComponent(key)}`), {
    method: 'PATCH',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to update LLM config', response.status);
  }

  return response.json();
}

/**
 * Seed default LLM configuration values.
 */
export async function seedLlmConfig(overwrite: boolean = false): Promise<{ message: string; stats: { created: number; updated: number; skipped: number } }> {
  const response = await fetch(buildUrl(`/admin/llm-config/seed?overwrite=${overwrite}`), {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to seed LLM config', response.status);
  }

  return response.json();
}

/**
 * Invalidate the LLM config cache.
 */
export async function invalidateLlmConfigCache(): Promise<{ message: string }> {
  const response = await fetch(buildUrl('/admin/llm-config/invalidate-cache'), {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new ApiClientError('Failed to invalidate cache', response.status);
  }

  return response.json();
}

// Bias Analysis API functions (Epic 10)
//
// Epic 11 Story 11.1: read article_bias_analyses directly from Supabase. The previous
// implementation called the local FastAPI backend, which is not reachable from Vercel,
// so bias badges always showed the placeholder in production.

const BIAS_COLUMNS = [
  'article_id',
  'provider',
  'model',
  'total_sentences',
  'journalist_bias_count',
  'quote_bias_count',
  'journalist_bias_percentage',
  'most_frequent_bias',
  'most_frequent_count',
  'average_bias_strength',
  'overall_rating',
  'journalist_biases',
  'quote_biases',
  'analyzed_at',
].join(', ');

/** Map an article_bias_analyses row to the shape the backend API used to return. */
export function mapBiasRow(row: any): ArticleBiasAnalysis {
  return {
    article_id: row.article_id,
    analyzed_at: row.analyzed_at,
    provider: row.provider,
    model: row.model,
    summary: {
      total_sentences: row.total_sentences ?? 0,
      journalist_bias_count: row.journalist_bias_count ?? 0,
      quote_bias_count: row.quote_bias_count ?? 0,
      journalist_bias_percentage: row.journalist_bias_percentage ?? 0,
      most_frequent_journalist_bias: row.most_frequent_bias ?? null,
      most_frequent_count: row.most_frequent_count ?? null,
      average_journalist_bias_strength: row.average_bias_strength ?? null,
      overall_journalist_rating: row.overall_rating ?? 0,
    },
    journalist_biases: Array.isArray(row.journalist_biases) ? row.journalist_biases : [],
    quote_biases: Array.isArray(row.quote_biases) ? row.quote_biases : [],
  };
}

/**
 * Fetch the latest bias analyses for multiple articles in one query.
 * Returns a map of articleId -> analysis (null if not available).
 */
export async function getArticleBiasesForEvent(
  articleIds: number[]
): Promise<Map<number, ArticleBiasAnalysis | null>> {
  const result = new Map<number, ArticleBiasAnalysis | null>(articleIds.map((id) => [id, null]));
  if (articleIds.length === 0) {
    return result;
  }

  const { data, error } = await getSupabase()
    .from('article_bias_analyses')
    .select(BIAS_COLUMNS)
    .in('article_id', articleIds)
    .order('analyzed_at', { ascending: false });

  if (error) {
    // Degrade gracefully: bias is supplementary information
    console.warn('[api] Failed to fetch bias analyses:', error.message);
    return result;
  }

  // Rows are ordered newest first; keep the latest analysis per article
  // Column list is built dynamically, so supabase-js cannot infer the row type
  for (const row of (data ?? []) as any[]) {
    if (result.get(row.article_id) == null) {
      result.set(row.article_id, mapBiasRow(row));
    }
  }
  return result;
}

/**
 * Fetch bias analysis for an article.
 * Returns null if no analysis exists.
 */
export async function getArticleBias(articleId: number): Promise<ArticleBiasAnalysis | null> {
  try {
    const analyses = await getArticleBiasesForEvent([articleId]);
    return analyses.get(articleId) ?? null;
  } catch (error) {
    // Missing configuration or network errors - return null to gracefully degrade
    console.warn(`[api] Failed to fetch bias for article ${articleId}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Epic 11: Onderzoeksmodus data
// ---------------------------------------------------------------------------------------------

const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';

/** Error codes meaning "this table does not exist (yet)" — e.g. before migration 004 is applied. */
/** A column added to migration 004 later (article_ids) that an older database does not have yet */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error) && (error?.code === '42703' || /column .* does not exist/i.test(error?.message ?? ''));
}

const ENTITY_COLUMNS = 'entity_key, name, kind, iso_code, aliases, mention_count, article_count, outlet_counts, salience';

async function getEventEntities(eventId: number) {
  const query = (columns: string) =>
    getSupabase().from('event_entities').select(columns).eq('event_id', eventId).order('salience', { ascending: false }).limit(40);
  const result = await query(`${ENTITY_COLUMNS}, article_ids`);
  return isMissingColumn(result.error) ? query(ENTITY_COLUMNS) : result;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? '');
}

async function loadDemo(identifier: string | number): Promise<RawExploration | null> {
  if (!DEMO_ENABLED) return null;
  const { findDemoEvent } = await import('@/lib/explore/fixtures/demo-event');
  const fixture = findDemoEvent(identifier);
  if (!fixture) return null;
  // Sources approved in the simulated "Stemmen zoeken" join the demo like they join a real event
  const { applyDemoVoices } = await import('@/lib/explore/fixtures/demo-voices');
  return applyDemoVoices(JSON.parse(JSON.stringify(fixture)) as RawExploration);
}

/**
 * Everything the Onderzoeksmodus needs for one event:
 * 1 round trip for event + articles + latest insight, then entities, relations and bias in parallel.
 */
export async function getExploration(identifier: string | number): Promise<RawExploration> {
  const demo = await loadDemo(identifier);
  if (demo) return demo;

  const isNumeric = typeof identifier === 'number' || /^\d+$/.test(String(identifier));
  const { data: event, error } = await getSupabase()
    .from('events')
    .select(`
      id, slug, event_type, article_count, first_seen_at, last_updated_at, archived_at,
      event_articles (
        found:scoring_breakdown->found_voice,
        articles ( id, title, url, source_name, published_at, is_international, source_country,
                   spectrum:source_metadata->spectrum, digest:source_metadata->digest )
      ),
      llm_insights ( ${INSIGHT_COLUMNS} )
    `)
    .eq(isNumeric ? 'id' : 'slug', isNumeric ? Number(identifier) : String(identifier))
    .order('generated_at', { referencedTable: 'llm_insights', ascending: false })
    .limit(1, { referencedTable: 'llm_insights' })
    .maybeSingle();

  if (error) {
    throw new ApiClientError(error.message, 500, { code: 'SUPABASE_ERROR', message: error.message });
  }
  if (!event) {
    throw new ApiClientError('Event not found', 404, { code: 'NOT_FOUND', message: 'Event not found' });
  }

  const row = event as any;
  const articles: RawExploreArticle[] = (row.event_articles ?? [])
    .filter((link: any) => link.articles)
    .map(({ articles: article, found }: any) => ({
      id: article.id,
      title: article.title,
      url: article.url,
      source_name: article.source_name ?? null,
      published_at: article.published_at ?? null,
      is_international: article.is_international ?? false,
      source_country: article.source_country ?? null,
      spectrum: article.spectrum ?? null,
      digest: article.digest ?? null,
      // Added for a missing voice (Story 14.10): what was found, on the link of this event
      found: found ?? null,
    }));
  const insightRow = Array.isArray(row.llm_insights) ? row.llm_insights[0] : row.llm_insights;

  const [entities, relations, bias] = await Promise.all([
    getEventEntities(row.id),
    getSupabase()
      .from('event_relations')
      .select('related_event_id, score, reasons, related_slug, related_title, related_event_type, related_article_count, related_first_seen_at, related_last_updated_at')
      .eq('event_id', row.id)
      .order('score', { ascending: false })
      .limit(12),
    getArticleBiasesForEvent(articles.filter((article) => !article.is_international).map((article) => article.id)),
  ]);

  return {
    event: {
      id: row.id,
      slug: row.slug ?? null,
      event_type: row.event_type ?? null,
      article_count: row.article_count ?? articles.length,
      first_seen_at: row.first_seen_at ?? null,
      last_updated_at: row.last_updated_at ?? null,
      archived_at: row.archived_at ?? null,
    },
    articles,
    insight: insightRow ? mapInsightRow(insightRow) : null,
    entities: entities.error ? [] : ((entities.data ?? []) as unknown as EventEntity[]),
    relations: relations.error ? [] : ((relations.data ?? []) as EventRelation[]),
    bias: Array.from(bias.values()).filter((analysis): analysis is ArticleBiasAnalysis => analysis !== null),
    availability: {
      entities: !isMissingTable(entities.error),
      relations: !isMissingTable(relations.error),
      bias: true,
    },
  };
}

/** Other events in which an entity (any of its alias slugs) appears. */
export async function getEntityAppearances(
  aliases: string[],
  excludeEventId: number,
  kind?: EventEntity['kind'] | null,
  options: { demo?: boolean } = {},
): Promise<EntityAppearance[]> {
  if (aliases.length === 0) return [];
  // Demo events have negative ids; pages outside an event (/actor) pass demo explicitly
  if (DEMO_ENABLED && (excludeEventId < 0 || options.demo)) {
    const { DEMO_EVENTS } = await import('@/lib/explore/fixtures/demo-event');
    return Object.values(DEMO_EVENTS)
      .filter((demo) => demo.event.id !== excludeEventId)
      .flatMap((demo) =>
        demo.entities
          .filter((entity) => (!kind || entity.kind === kind) && entity.aliases.some((alias) => aliases.includes(alias)))
          .map((entity) => ({
            event_id: demo.event.id,
            event_slug: demo.event.slug,
            event_title: demo.insight?.summary?.split('\n')[0] ?? `Event ${demo.event.id}`,
            event_type: demo.event.event_type,
            event_last_updated_at: demo.event.last_updated_at,
            mention_count: entity.mention_count,
          })),
      );
  }

  let query = getSupabase()
    .from('event_entities')
    .select('event_id, event_slug, event_title, event_type, event_last_updated_at, mention_count')
    .overlaps('aliases', aliases)
    .neq('event_id', excludeEventId);
  if (kind) {
    // Aliases are not unique (common surnames collide): match the same kind of entity
    query = query.eq('kind', kind);
  }
  const { data, error } = await query
    .order('event_last_updated_at', { ascending: false })
    .limit(12);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new ApiClientError(error.message, 500, { code: 'SUPABASE_ERROR', message: error.message });
  }
  const seen = new Set<number>();
  return ((data ?? []) as EntityAppearance[]).filter((row) => {
    if (seen.has(row.event_id)) return false;
    seen.add(row.event_id);
    return true;
  }).slice(0, 8);
}

const ARTICLE_REF_COLUMNS = 'id, title, url, source_name, published_at, is_international, source_country';

/**
 * Events in which an entity appears (all, or all but `excludeEventId`), each with the articles that
 * mention it (event_entities.article_ids), newest events first, at most 20.
 * Falls back to events without articles on a database that does not have article_ids yet.
 */
export async function getEntityArticles(
  aliases: string[],
  options: { excludeEventId?: number | null; kind?: EventEntity['kind'] | null; demo?: boolean } = {},
): Promise<EntityArticleGroup[]> {
  const { excludeEventId = null, kind = null } = options;
  if (aliases.length === 0) return [];
  if (DEMO_ENABLED && (options.demo ?? (excludeEventId !== null && excludeEventId < 0))) {
    const { DEMO_EVENTS } = await import('@/lib/explore/fixtures/demo-event');
    return Object.values(DEMO_EVENTS)
      .filter((demo) => demo.event.id !== excludeEventId)
      .flatMap((demo) =>
        demo.entities
          .filter((entity) => (!kind || entity.kind === kind) && entity.aliases.some((alias) => aliases.includes(alias)))
          .map((entity) => ({
            event_id: demo.event.id,
            event_slug: demo.event.slug,
            event_title: demo.insight?.summary?.split('\n')[0] ?? `Event ${demo.event.id}`,
            event_last_updated_at: demo.event.last_updated_at,
            mention_count: entity.mention_count,
            // Newest first, like the Supabase branch
            articles: demo.articles
              .filter((article) => (entity.article_ids ?? []).includes(article.id))
              .sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? ''))),
          })),
      );
  }

  const query = (columns: string) => {
    let builder = getSupabase().from('event_entities').select(columns).overlaps('aliases', aliases);
    if (excludeEventId !== null) builder = builder.neq('event_id', excludeEventId);
    // Aliases are not unique (common surnames collide): match the same kind of entity
    if (kind) builder = builder.eq('kind', kind);
    return builder.order('event_last_updated_at', { ascending: false }).limit(20);
  };
  const base = 'event_id, event_slug, event_title, event_last_updated_at, mention_count';
  let result = await query(`${base}, article_ids`);
  if (isMissingColumn(result.error)) result = await query(base);
  if (result.error) {
    if (isMissingTable(result.error)) return [];
    throw new ApiClientError(result.error.message, 500, { code: 'SUPABASE_ERROR', message: result.error.message });
  }

  const groups = new Map<number, EntityArticleGroup & { ids: number[] }>();
  for (const row of (result.data ?? []) as any[]) {
    if (groups.has(row.event_id)) continue;
    groups.set(row.event_id, {
      event_id: row.event_id,
      event_slug: row.event_slug ?? null,
      event_title: row.event_title,
      event_last_updated_at: row.event_last_updated_at ?? null,
      mention_count: row.mention_count ?? 0,
      articles: [],
      ids: (row.article_ids ?? []) as number[],
    });
  }
  const ids = Array.from(new Set(Array.from(groups.values()).flatMap((group) => group.ids))).slice(0, 150);
  if (ids.length) {
    const { data, error } = await getSupabase().from('articles').select(ARTICLE_REF_COLUMNS).in('id', ids);
    if (!error) {
      const byId = new Map(((data ?? []) as ArticleRef[]).map((article) => [article.id, article]));
      for (const group of Array.from(groups.values())) {
        group.articles = group.ids
          .map((id) => byId.get(id))
          .filter((article): article is ArticleRef => Boolean(article))
          .sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')));
      }
    }
  }
  return Array.from(groups.values()).map(({ ids: _ids, ...group }) => group);
}

/**
 * Full-text search in all articles (title, intro and text; RPC search_articles, migration 004).
 * Title matches first, then newest first. Only references come back, never article text.
 * Returns null when search is not available yet.
 */
export async function searchArticles(
  query: string,
  options: { demo?: boolean; limit?: number; offset?: number } = {},
): Promise<ArticleSearchResult | null> {
  const q = query.trim();
  if (q.length < 2) return { total: 0, items: [] };
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  if (DEMO_ENABLED && options.demo) {
    const { DEMO_EVENTS } = await import('@/lib/explore/fixtures/demo-event');
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const items: ArticleRef[] = Object.values(DEMO_EVENTS)
      .flatMap((demo) =>
        demo.articles.map((article) => ({
          ...article,
          event_id: demo.event.id,
          event_slug: demo.event.slug,
          event_title: demo.insight?.summary?.split('\n')[0] ?? null,
        })),
      )
      .filter((article) => words.every((word) => article.title.toLowerCase().includes(word)))
      .sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')));
    return { total: items.length, items: items.slice(offset, offset + limit) };
  }
  return pmRpc<ArticleSearchResult>('search_articles', { p_query: q, p_limit: limit, p_offset: offset });
}

/** Wikipedia summary (plain text). Returns null when the page does not exist. */
export async function getWikipediaSummary(title: string, lang = 'nl'): Promise<WikiSummary | null> {
  const response = await fetch(wikiSummaryUrl(title, lang), { headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiClientError('Wikipedia niet bereikbaar', response.status);
  }
  return parseWikiSummary(await response.json(), lang);
}

export async function searchWikipedia(query: string, lang = 'nl'): Promise<WikiCandidate[]> {
  const response = await fetch(wikiSearchUrl(query, lang));
  if (!response.ok) return [];
  return parseWikiSearch(await response.json());
}

// ---------------------------------------------------------------------------------------------
// Epic 11 Story 11.17: propaganda-model graph, one step at a time (RPC functions, migration 005)
// ---------------------------------------------------------------------------------------------

let demoPm: ReturnType<typeof createLocalPm> | null = null;

async function localPm() {
  if (!demoPm) {
    const slice = (await import('@/lib/explore/fixtures/demo-pm.json')).default as unknown as PmSlice;
    // Epic 12: plus what the (fictional) demo research added
    const { DEMO_PM_ADDITIONS } = await import('@/lib/explore/fixtures/demo-research');
    demoPm = createLocalPm(extendSlice(slice, DEMO_PM_ADDITIONS));
  }
  return demoPm;
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || isMissingTable(error) || /could not find the function/i.test(error.message ?? '');
}

/** RPC call that tells a missing function (migration not run yet) apart from an empty result. */
async function rpcCall<T>(fn: string, args: Record<string, unknown>): Promise<{ missing: boolean; data: T | null }> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) {
    if (isMissingFunction(error)) return { missing: true, data: null };
    throw new ApiClientError(error.message, 500, { code: 'SUPABASE_ERROR', message: error.message });
  }
  return { missing: false, data: (data ?? null) as T | null };
}

/** RPC call that returns null when the function does not exist yet (before migration 005). */
async function pmRpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  return (await rpcCall<T>(fn, args)).data;
}

/** Use the bundled demo slice (demo events) instead of Supabase. */
function isDemoPm(demo: boolean | undefined): boolean {
  return DEMO_ENABLED && Boolean(demo);
}

export async function pmMeta(options: { demo?: boolean } = {}): Promise<PmMeta | null> {
  if (isDemoPm(options.demo)) return (await localPm()).meta();
  return pmRpc<PmMeta>('pm_meta_info', {});
}

export async function pmMatch(aliases: string[], options: { demo?: boolean } = {}): Promise<PmMatch[]> {
  const clean = Array.from(new Set(aliases.filter(Boolean))).slice(0, 100);
  if (clean.length === 0) return [];
  if (isDemoPm(options.demo)) return (await localPm()).match(clean);
  return (await pmRpc<PmMatch[]>('pm_match', { p_aliases: clean })) ?? [];
}

export async function pmSearch(query: string, options: { demo?: boolean; limit?: number } = {}): Promise<PmEntity[]> {
  if (query.trim().length < 2) return [];
  if (isDemoPm(options.demo)) return (await localPm()).search(query, options.limit);
  return (await pmRpc<PmEntity[]>('pm_search', { p_query: query, p_limit: options.limit ?? 10 })) ?? [];
}

/**
 * Neighbours of one entity, optionally only via some filters and one way of influence ("in": on the
 * entity, "out": the entity's), with counts per filter (and per direction, migration 008) either way.
 */
export async function pmNeighborhood(
  entityId: number,
  options: { demo?: boolean; limit?: number; filters?: string[] | null; direction?: 'in' | 'out' | null } = {},
): Promise<PmNeighborhood | null> {
  const filters = options.filters?.length ? options.filters : null;
  const direction = options.direction ?? null;
  if (isDemoPm(options.demo)) return (await localPm()).neighborhood(entityId, options.limit, filters, direction);
  const args: Record<string, unknown> = { p_entity_id: entityId, p_limit: options.limit ?? 40 };
  if (filters) args.p_filters = filters;
  if (direction) args.p_direction = direction;
  const { missing, data } = await rpcCall<PmNeighborhood>('pm_neighborhood', args);
  if (missing && direction) {
    // Before migration 008: fetch either way and keep the relations that go this way
    const both = await pmNeighborhood(entityId, { limit: 60, filters });
    return both ? { ...filterNeighborhood(both, filters ?? [], direction), filters, truncated: both.truncated } : null;
  }
  return data && data.center ? data : null;
}

export async function pmDetails(kind: 'entity' | 'relation', id: number, options: { demo?: boolean } = {}): Promise<PmDetails | null> {
  if (isDemoPm(options.demo)) return (await localPm()).details(kind, id);
  return pmRpc<PmDetails>('pm_details', { p_kind: kind, p_id: id });
}

/**
 * Story 14.12: the arguments behind at most 40 relations at once (pm_relation_arguments, migration
 * 010), per relation id. Null when the function does not exist yet (before the migration).
 */
export async function pmRelationArguments(ids: number[], options: { demo?: boolean } = {}): Promise<Map<number, PmArgument[]> | null> {
  const clean = Array.from(new Set(ids.filter((id) => Number.isInteger(id)))).slice(0, 40);
  if (clean.length === 0) return new Map();
  const rows = isDemoPm(options.demo)
    ? (await localPm()).relationArguments(clean)
    : await pmRpc<{ relation_id: number; arguments: PmArgument[] }[]>('pm_relation_arguments', { p_ids: clean });
  if (!rows) return null;
  return new Map(rows.map((row) => [row.relation_id, row.arguments ?? []]));
}

/**
 * Story 14.13: register that this event page shows thin links (request_relation_research,
 * migration 011) and get their research status back. The database ignores well supported links
 * and ties of persons, limits the rate and decides nothing: the backend queues within a budget.
 * Null when the function does not exist yet or for the demo (no research there).
 */
export async function requestRelationResearch(
  ids: number[],
  eventSlug: string | null,
  options: { demo?: boolean } = {},
): Promise<Map<number, RelationResearch> | null> {
  const clean = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 12);
  if (clean.length === 0 || isDemoPm(options.demo)) return null;
  const rows = await pmRpc<RelationResearch[]>('request_relation_research', { p_ids: clean, p_event_slug: eventSlug ?? null });
  return rows ? new Map(rows.map((row) => [row.relation_id, row])) : null;
}

/** Research status of at most 40 links (relation_research_status); null before migration 011. */
export async function relationResearchStatus(ids: number[], options: { demo?: boolean } = {}): Promise<Map<number, RelationResearch> | null> {
  const clean = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0))).slice(0, 40);
  if (clean.length === 0 || isDemoPm(options.demo)) return null;
  const rows = await pmRpc<RelationResearch[]>('relation_research_status', { p_ids: clean });
  return rows ? new Map(rows.map((row) => [row.relation_id, row])) : null;
}

/**
 * Epic 13: the best routes between two sets of entities (pm_paths, migration 007): the network
 * between things instead of around one node. Null when the function does not exist yet.
 */
export async function pmPaths(
  from: number[],
  to: number[],
  options: { demo?: boolean; maxHops?: number; limit?: number; at?: string | null } = {},
): Promise<PmPaths | null> {
  const fromIds = Array.from(new Set(from)).slice(0, 12);
  const toIds = Array.from(new Set(to)).slice(0, 40);
  if (fromIds.length === 0 || toIds.length === 0) return null;
  if (isDemoPm(options.demo)) return (await localPm()).paths(fromIds, toIds, { maxHops: options.maxHops, limit: options.limit, at: options.at });
  const args: Record<string, unknown> = { p_from: fromIds, p_to: toIds, p_max_hops: options.maxHops ?? 3, p_limit: options.limit ?? 2 };
  if (options.at) args.p_at = options.at;
  return pmRpc<PmPaths>('pm_paths', args);
}

// ---------------------------------------------------------------------------------------------
// Epic 12 "Wie is dit?": automatic research of names in the news (RPC functions, migration 006)
// ---------------------------------------------------------------------------------------------

/**
 * Ask the backend to research a name that appears in the news (request_entity_research). The
 * database decides (rate limits, cool-down, private persons). Returns null when the function does
 * not exist yet. Demo: simulated client-side.
 */
export async function requestEntityResearch(
  key: string,
  name: string,
  kind: EntityResearchKind,
  eventSlug: string | null,
  options: { demo?: boolean } = {},
): Promise<EntityResearchRequest | null> {
  if (!key || !name.trim()) return null;
  if (isDemoPm(options.demo)) {
    const { demoRequestResearch } = await import('@/lib/explore/fixtures/demo-research');
    return demoRequestResearch(key, name, kind);
  }
  return pmRpc<EntityResearchRequest>('request_entity_research', {
    p_key: key,
    p_name: name.trim(),
    p_kind: kind,
    p_event_slug: eventSlug ?? null,
  });
}

/**
 * Research status for up to 50 keys (entity_research_status). null = the function does not exist
 * yet (migration 006 not run): callers then show nothing.
 */
export async function getEntityResearch(keys: string[], options: { demo?: boolean } = {}): Promise<EntityResearch[] | null> {
  const clean = Array.from(new Set(keys.filter(Boolean))).slice(0, 50);
  if (clean.length === 0) return [];
  if (isDemoPm(options.demo)) {
    const { demoResearchStatus } = await import('@/lib/explore/fixtures/demo-research');
    return demoResearchStatus(clean);
  }
  const { missing, data } = await rpcCall<EntityResearch[]>('entity_research_status', { p_keys: clean });
  if (missing) return null;
  return Array.isArray(data) ? data : [];
}

/** People and organisations that appear in the same news (entity_cooccurrence); [] when unavailable. */
export async function getEntityCooccurrence(
  aliases: string[],
  options: { demo?: boolean; limit?: number } = {},
): Promise<EntityCooccurrence[]> {
  const clean = Array.from(new Set(aliases.filter(Boolean))).slice(0, 50);
  if (clean.length === 0) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  if (isDemoPm(options.demo)) {
    const { demoCooccurrence } = await import('@/lib/explore/fixtures/demo-research');
    return demoCooccurrence(clean, limit);
  }
  const data = await pmRpc<EntityCooccurrence[]>('entity_cooccurrence', { p_aliases: clean, p_limit: limit });
  return Array.isArray(data) ? data : [];
}

export type {
  AggregationResponse,
  ArticleBiasAnalysis,
  ArticleBiasResponse,
  Cluster,
  ClusterSource,
  Contradiction,
  EventArticle,
  EventDetail,
  EventDetailMeta,
  EventFeedMeta,
  EventListItem,
  EventSourceBreakdownEntry,
  Fallacy,
  SentenceBias,
  SpectrumDistribution,
  TimelineEvent,
} from "@/lib/types";
