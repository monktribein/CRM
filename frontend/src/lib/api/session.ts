import type { Session } from "@/lib/types";

/**
 * Holds the short-lived access token in memory only — never in localStorage
 * or sessionStorage, so it can't be read by injected scripts after a reload.
 * The long-lived refresh token is an HttpOnly cookie set by the backend; on
 * page load the app calls POST /auth/refresh to obtain a new access token.
 */
let current: Session | null = null;

type Listener = (reason: "expired" | "signed_out") => void;
const listeners = new Set<Listener>();

export const sessionStore = {
  get(): Session | null {
    return current;
  },
  set(session: Session) {
    current = session;
    sessionHint.set(true);
  },
  clear(reason: "expired" | "signed_out" = "signed_out") {
    current = null;
    sessionHint.set(false);
    listeners.forEach((l) => l(reason));
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function isExpiringSoon(session: Session, skewMs = 30_000) {
  const t = Date.parse(session.expiresAt);
  return Number.isFinite(t) && t - skewMs <= Date.now();
}

/**
 * Non-sensitive hint that this browser has a refresh cookie, so first-time
 * visitors don't trigger a pointless (and noisy) 401 from POST /auth/refresh.
 * It contains no token; the HttpOnly cookie remains the source of truth.
 */
const HINT_KEY = "bn.hasSession";

export const sessionHint = {
  get(): boolean {
    try {
      return window.localStorage.getItem(HINT_KEY) === "1";
    } catch {
      return true; // storage unavailable: fall back to asking the server
    }
  },
  set(on: boolean) {
    try {
      if (on) window.localStorage.setItem(HINT_KEY, "1");
      else window.localStorage.removeItem(HINT_KEY);
    } catch {
      /* ignore */
    }
  },
};
