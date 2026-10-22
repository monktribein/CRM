/**
 * Runtime configuration. Only NEXT_PUBLIC_* values are readable in the browser,
 * so nothing secret may ever be placed here.
 */

/**
 * Accepts the backend address with or without the version prefix:
 * "https://api.example.com" and "https://api.example.com/api/v1" both work.
 */
function normaliseApiUrl(raw: string) {
  const base = raw.trim().replace(/\/+$/, "");
  if (!base) return "";
  return /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`;
}

const rawApiUrl = normaliseApiUrl(process.env.NEXT_PUBLIC_API_URL ?? "");

export const config = {
  appName: "Bizwoke Nova",
  /** Backend base URL, without a trailing slash. */
  apiUrl: rawApiUrl.replace(/\/+$/, ""),
  /**
   * Demo data is strictly development-only: it requires `next dev` AND an
   * explicit opt-in flag. Production builds dead-code-eliminate the demo
   * backend entirely because NODE_ENV is inlined as "production".
   */
  demoMode:
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DEMO_MODE === "true",
} as const;

export function isApiConfigured() {
  return config.demoMode || config.apiUrl.length > 0;
}
