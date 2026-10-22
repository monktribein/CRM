"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ErrorState, FullPageLoader } from "@/components/common/states";
import { useAuth } from "@/components/providers/auth-provider";
import { BreadcrumbProvider } from "@/components/layout/breadcrumb-context";
import { requiredPermissions } from "@/components/layout/nav";
import { SidebarContent } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "bn.sidebar.collapsed";

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* preference only */
      }
      return !c;
    });
  };

  return (
    <BreadcrumbProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 lg:block",
            collapsed ? "w-16" : "w-60"
          )}
        >
          <SidebarContent collapsed={collapsed} onToggle={toggle} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 border-0 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main navigation</SheetDescription>
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className={cn("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-60")}>
          <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
          <main id="main" className="flex-1 px-4 py-6 lg:px-6">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="mx-auto w-full max-w-[1400px]"
            >
              {children}
            </motion.div>
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}

function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-workspace px-4">
      <div className="max-w-sm rounded-lg border bg-card text-center shadow-xs">
        <ErrorState
          error={new Error("We couldn't reach the Bizwoke Nova server to restore your session. You're still signed in.")}
          title="Server unavailable"
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}

/**
 * Client-side route protection. This is a UX layer only — every API call is
 * authorised by the backend, which is the real security boundary.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, canAny, retry } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const needed = requiredPermissions(pathname);
  const allowed = status === "authenticated" && (needed.length === 0 || canAny(needed));

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (status === "authenticated" && !allowed) {
      router.replace(`/access-denied?from=${encodeURIComponent(pathname)}`);
    }
  }, [status, allowed, pathname, router]);

  if (status === "loading") return <FullPageLoader />;
  if (status === "unreachable") return <ServerUnreachable onRetry={retry} />;
  if (status === "unauthenticated") return <FullPageLoader label="Redirecting to sign in…" />;
  if (!allowed) return <FullPageLoader label="Checking access…" />;
  return <Shell>{children}</Shell>;
}
