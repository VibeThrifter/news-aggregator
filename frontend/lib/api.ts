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
