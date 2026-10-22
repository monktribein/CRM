"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { refreshSession } from "@/lib/api/client";
import { sessionHint, sessionStore } from "@/lib/api/session";
import { authApi } from "@/lib/api/services";
import type { CurrentUser, Permission } from "@/lib/types";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";

/** "unreachable": the session couldn't be checked (server down / rate limited) — not signed out. */
type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "unreachable";

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  login: (email: string, password: string) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  setUser: (user: CurrentUser) => void;
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  /** Re-checks the session after an "unreachable" result. */
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUserState] = useState<CurrentUser | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const [attempt, setAttempt] = useState(0);

  // Restore the session from the HttpOnly refresh cookie on first load.
  // Transient failures (429 / 5xx / offline) are retried with backoff and
  // never treated as "signed out".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionHint.get()) {
        setStatus("unauthenticated");
        return;
      }
      for (const delay of [0, 800, 2000, 4000]) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        const result = await refreshSession();
        if (cancelled) return;
        if (result.ok) {
          setUserState(result.data.user);
          setStatus("authenticated");
          return;
        }
        if (result.reason === "invalid") {
          setStatus("unauthenticated");
          return;
        }
      }
      setStatus("unreachable");
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((a) => a + 1);
  }, []);

  // React to the API client clearing the session (refresh failed → expired).
  useEffect(() => {
    return sessionStore.subscribe((reason) => {
      setUserState(null);
      setStatus("unauthenticated");
      queryClient.clear();
      if (reason === "expired") {
        toast.error("Your session has expired", { description: "Please sign in again to continue." });
        const next = window.location.pathname + window.location.search;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      }
    });
  }, [queryClient, router]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    sessionStore.set({ accessToken: result.accessToken, expiresAt: result.expiresAt });
    setUserState(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* the server revokes the refresh token; local sign-out proceeds regardless */
    }
    sessionStore.clear("signed_out");
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login,
      logout,
      setUser: setUserState,
      can: (p) => hasPermission(user, p),
      canAny: (ps) => hasAnyPermission(user, ps),
      retry,
    }),
    [status, user, login, logout, retry]
  );


  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** For components rendered inside the authenticated shell. */
export function useCurrentUser(): CurrentUser {
  const { user } = useAuth();
  if (!user) throw new Error("useCurrentUser called outside an authenticated route");
  return user;
}
