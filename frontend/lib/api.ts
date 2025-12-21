import type {
  AggregationResponse,
  EventArticle,
  EventDetail,
  EventDetailMeta,
  EventFeedMeta,
  EventListItem,
  EventSourceBreakdownEntry,
  SpectrumDistribution,
} from "@/lib/types";
import { supabase } from "@/lib/supabase";

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
}

/** Maximum events returned when searching all periods */
const SEARCH_ALL_LIMIT = 50;

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

function extractTitleFromSummary(summary: string | null | undefined): { title: string | null; description: string | null } {
  if (!summary) {
    return { title: null, description: null };
  }
  // Split on first sentence ending (. ! ?)
  const match = summary.match(/^(.+?[.!?])\s*(.*)$/s);
  if (match) {
    return { title: match[1].trim(), description: match[2].trim() || null };
  }
  // No sentence ending found, use whole text as title
  return { title: summary, description: null };
}

export async function listEvents(
  filters?: EventListFilters,
  options?: ApiFetchOptions
): Promise<ApiResponse<EventListItem[]>> {
  const { startDate, endDate, category, minSources = 1, search, searchAllPeriods = false, includeWithoutInsights = false } = filters ?? {};

  // Build query with server-side filters
  // By default, only show events with LLM insights (to avoid showing article titles which is copyright)
  // Admin mode (includeWithoutInsights) shows all events
  let query = supabase
    .from('events')
    .select(`
      *,
      llm_insights${includeWithoutInsights ? '' : '!inner'} (summary),
      event_articles (
        articles (
          source_name,
          source_metadata
        )
      )
    `)
    .is('archived_at', null);

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

  // Order by most recently updated and apply limit for all-periods search
  query = query.order('last_updated_at', { ascending: false });
  if (searchAllPeriods) {
    query = query.limit(SEARCH_ALL_LIMIT);
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
    // llm_insights is an array from Supabase join, get first element
    const insightSummary = event.llm_insights?.[0]?.summary;
    const { title: llmTitle, description: llmDescription } = extractTitleFromSummary(insightSummary);

    // Build source_breakdown from event_articles
    const sourceBreakdownMap = new Map<string, { source: string; article_count: number; spectrum: string | number | null }>();
    for (const ea of event.event_articles || []) {
      const article = ea.articles;
      if (!article) continue;
      const source = article.source_name || 'Unknown';
      const spectrum = article.source_metadata?.spectrum || null;
      const key = `${source}|${spectrum || ''}`;
      const existing = sourceBreakdownMap.get(key);
      if (existing) {
        existing.article_count++;
      } else {
        sourceBreakdownMap.set(key, { source, article_count: 1, spectrum });
      }
    }
    const source_breakdown: EventSourceBreakdownEntry[] = Array.from(sourceBreakdownMap.values());

    return {
      id: event.id,
      slug: event.slug,
      // Use LLM-generated title if available, otherwise fall back to event title
      title: llmTitle || event.title || `Event ${event.id}`,
      // Use LLM description (rest of summary), or null if no LLM insights
      description: llmDescription,
      summary: insightSummary,
      // Flag to indicate if this event has LLM-generated content
      has_llm_insights: !!insightSummary,
      article_count: event.article_count || 0,
      first_seen_at: event.first_seen_at,
      last_updated_at: event.last_updated_at,
      spectrum_distribution: event.spectrum_distribution,
      source_breakdown,
      event_type: event.event_type || null,
    };
  });

  return { data: events };
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
  const query = supabase.from('events').select('*');

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
  const { data: eventArticles, error: articlesError } = await supabase
    .from('event_articles')
    .select(`
      article_id,
      similarity_score,
      articles (*)
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
  }));

  // Build source_breakdown from articles
  const sourceBreakdownMap = new Map<string, { source: string; article_count: number; spectrum: string | number | null }>();
  for (const article of articles) {
    const key = `${article.source}|${article.spectrum || ''}`;
    const existing = sourceBreakdownMap.get(key);
    if (existing) {
      existing.article_count++;
    } else {
      sourceBreakdownMap.set(key, {
        source: article.source,
        article_count: 1,
        spectrum: article.spectrum || null,
      });
    }
  }
  const source_breakdown: EventSourceBreakdownEntry[] = Array.from(sourceBreakdownMap.values());

  const eventDetail: EventDetail = {
    id: event.id,
    slug: event.slug,
    title: event.title || `Event ${event.id}`,
    description: event.description,
    article_count: event.article_count || 0,
    first_seen_at: event.first_seen_at,
    last_updated_at: event.last_updated_at,
    spectrum_distribution: event.spectrum_distribution,
    source_breakdown,
    articles,
  };

  return { data: eventDetail };
}

export async function getEventInsights(eventId: string | number, options?: ApiFetchOptions): Promise<ApiResponse<AggregationResponse>> {
  // First, get the event to find its numeric ID if a slug was provided
  const isNumeric = typeof eventId === 'number' || !isNaN(Number(eventId));
  let numericEventId: number;

  if (isNumeric) {
    numericEventId = Number(eventId);
  } else {
    // Fetch event by slug to get numeric ID
    const { data: event } = await supabase
      .from('events')
      .select('id')
      .eq('slug', eventId)
      .single();

    if (!event) {
      // Event not found, return empty insights
      return {
        data: {
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
          scientific_plurality: null,
        },
      };
    }
    numericEventId = event.id;
  }

  const { data: insights, error } = await supabase
    .from('llm_insights')
    .select('*')
    .eq('event_id', numericEventId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    throw new ApiClientError(error.message, 500, {
      code: 'SUPABASE_ERROR',
      message: error.message,
    });
  }

  if (!insights) {
    // No insights generated yet
    return {
      data: {
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
        scientific_plurality: null,
      },
    };
  }

  return {
    data: {
      query: '',
      generated_at: insights.generated_at,
      llm_provider: insights.provider,
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
      scientific_plurality: insights.scientific_plurality || null,
    },
  };
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
  spectrum: string | null;
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

export type {
  AggregationResponse,
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
  SpectrumDistribution,
  TimelineEvent,
} from "@/lib/types";
