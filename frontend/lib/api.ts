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
  daysBack?: number;
  category?: string;
  minSources?: number;
  search?: string;
}

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
  const { daysBack = 7, category, minSources = 1, search } = filters ?? {};

  // Calculate the cutoff date for filtering
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffIso = cutoffDate.toISOString();

  // Build query with server-side filters
  let query = supabase
    .from('events')
    .select(`
      *,
      llm_insights (summary)
    `)
    .is('archived_at', null)
    .gte('last_updated_at', cutoffIso);

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

  // Order by most recently updated
  const { data, error } = await query.order('last_updated_at', { ascending: false });

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
    summary: ea.articles.summary,
    published_at: ea.articles.published_at,
    image_url: ea.articles.image_url,
  }));

  const eventDetail: EventDetail = {
    id: event.id,
    slug: event.slug,
    title: event.title || `Event ${event.id}`,
    description: event.description,
    article_count: event.article_count || 0,
    first_seen_at: event.first_seen_at,
    last_updated_at: event.last_updated_at,
    spectrum_distribution: event.spectrum_distribution,
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
