import { config } from "@/lib/config";
import { isExpiringSoon, sessionHint, sessionStore } from "@/lib/api/session";
import type { LoginResponse, Paginated } from "@/lib/types";

/**
 * Backend response envelope:
 *   success → { data: T, meta?: { total, page, pageSize } }
 *   error   → { statusCode, error, message, details?, requestId?, timestamp, path }
 */
interface SuccessEnvelope<T> {
  data: T;
  meta?: { total: number; page: number; pageSize: number };
}

interface ErrorEnvelope {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  code?: string;
  details?: Record<string, string[]>;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(
    status: number,
    message: string,
    options: { code?: string; fieldErrors?: Record<string, string[]>; requestId?: string } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code;
    this.fieldErrors = options.fieldErrors;
    this.requestId = options.requestId;
  }
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong.") {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type QueryValue = string | number | boolean | null | undefined | (string | number)[];

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** Auth endpoints: a 401 means bad credentials, not an expired session. */
  skipAuthRefresh?: boolean;
}

export function buildQuery(query: RequestOptions["query"]) {
  const params = new URLSearchParams();
  if (!query) return "";
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function transport(url: string, init: RequestInit): Promise<Response> {
  // Development-only demo backend. The condition is written inline (rather
  // than via `config`) so production builds drop the import entirely.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  ) {
    const { handleDemoRequest } = await import("@/lib/demo/server");
    return handleDemoRequest(url, init);
  }

  if (!config.apiUrl) {
    throw new ApiError(0, "The API is not configured. Set NEXT_PUBLIC_API_URL to your backend URL.");
  }

  try {
    return await fetch(`${config.apiUrl}${url}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Unable to reach the server. Check your connection and try again.");
  }
}

function buildInit(options: RequestOptions, accept = "application/json"): RequestInit {
  const headers: Record<string, string> = { Accept: accept };
  const session = sessionStore.get();
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    // The browser sets the multipart boundary itself.
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return {
    method: options.method ?? "GET",
    headers,
    body,
    signal: options.signal,
    // Sends the HttpOnly refresh cookie to the API origin.
    credentials: "include",
    cache: "no-store",
  };
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "The request was invalid.",
  401: "Your session has expired. Please sign in again.",
  403: "You don't have permission to perform this action.",
  404: "The requested resource was not found.",
  409: "This change conflicts with the current state. Refresh and try again.",
  422: "Some fields need attention.",
  429: "Too many requests. Please wait a moment and try again.",
};

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ErrorEnvelope = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON error body */
  }
  const message = Array.isArray(payload.message) ? payload.message[0] : payload.message;
  return new ApiError(
    response.status,
    message ?? DEFAULT_MESSAGES[response.status] ?? "The server returned an error. Please try again.",
    { code: payload.code, fieldErrors: payload.details, requestId: payload.requestId }
  );
}

/* ---------- Access-token refresh (single flight) ---------- */

/**
 * "invalid": the refresh cookie is missing/expired/revoked (HTTP 401) → signed out.
 * "unavailable": rate limited, server error or network failure → keep the
 * session and retry later; never log the user out for a transient problem.
 */
export type RefreshOutcome =
  | { ok: true; data: LoginResponse }
  | { ok: false; reason: "invalid" | "unavailable" };

let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * Exchanges the HttpOnly refresh cookie for a new access token. The backend
 * rotates the refresh token on every call. Concurrent callers share one
 * request so rotation can't race.
 */
export function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= (async (): Promise<RefreshOutcome> => {
    try {
      const response = await transport("/auth/refresh", {
        ...buildInit({ method: "POST" }),
        headers: { Accept: "application/json" },
      });
      if (response.status === 401 || response.status === 403) {
        sessionHint.set(false);
        return { ok: false, reason: "invalid" };
      }
      if (!response.ok) return { ok: false, reason: "unavailable" };
      const { data } = (await response.json()) as SuccessEnvelope<LoginResponse>;
      sessionStore.set({ accessToken: data.accessToken, expiresAt: data.expiresAt });
      return { ok: true, data };
    } catch {
      return { ok: false, reason: "unavailable" };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function send(path: string, options: RequestOptions, accept?: string): Promise<Response> {
  const url = `${path}${buildQuery(options.query)}`;
  const session = sessionStore.get();
  if (!options.skipAuthRefresh && session && isExpiringSoon(session)) {
    await refreshSession();
  }

  let response = await transport(url, buildInit(options, accept));
  if (response.status === 401 && !options.skipAuthRefresh) {
    const refreshed = await refreshSession();
    if (!refreshed.ok && refreshed.reason === "unavailable") {
      // Keep the user signed in; the request can simply be retried.
      throw new ApiError(503, "Couldn't renew your session right now. Please try again in a moment.", { code: "refresh_unavailable" });
    }
    if (refreshed.ok) response = await transport(url, buildInit(options, accept));
    if (response.status === 401) {
      sessionStore.clear("expired");
      throw new ApiError(401, DEFAULT_MESSAGES[401]!, { code: "session_expired" });
    }
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return (JSON.parse(text) as SuccessEnvelope<T>).data;
}

export async function apiPaginated<T>(path: string, options: RequestOptions = {}): Promise<Paginated<T>> {
  const response = await send(path, options);
  const body = (await response.json()) as SuccessEnvelope<T[]>;
  return {
    items: body.data,
    total: body.meta?.total ?? body.data.length,
    page: body.meta?.page ?? 1,
    pageSize: body.meta?.pageSize ?? body.data.length,
  };
}

/** Fetches a file response (e.g. a CSV report export or an image) as a Blob. */
export async function apiDownload(
  path: string,
  options: RequestOptions = {},
  accept = "text/csv, application/octet-stream"
): Promise<{ blob: Blob; fileName: string | null }> {
  const response = await send(path, options, accept);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return { blob: await response.blob(), fileName: match ? decodeURIComponent(match[1]!) : null };
}
