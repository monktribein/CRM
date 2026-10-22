import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoader } from "@/components/common/states";

/**
 * Authenticated pages render only after the browser has restored the session
 * (HttpOnly refresh cookie → access token), so they can't be prerendered or
 * validated for instant navigation; the static shell is the loader below.
 */
export const instant = false;

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  // The shell reads the URL and the session on the client; Suspense lets
  // the static loader prerender while that resolves at runtime.
  return (
    <Suspense fallback={<FullPageLoader />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
