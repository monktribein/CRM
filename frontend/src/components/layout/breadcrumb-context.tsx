"use client";

import { createContext, useContext, useEffect, useState } from "react";

/** Lets a page replace the label of a dynamic segment (e.g. a task key). */
const Ctx = createContext<{
  overrides: Record<string, string>;
  set: (segment: string, label: string | null) => void;
} | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const set = (segment: string, label: string | null) =>
    setOverrides((prev) => {
      const next = { ...prev };
      if (label) next[segment] = label;
      else delete next[segment];
      return next;
    });
  return <Ctx.Provider value={{ overrides, set }}>{children}</Ctx.Provider>;
}

export function useBreadcrumbOverrides() {
  return useContext(Ctx)?.overrides ?? {};
}

export function useBreadcrumbLabel(segment: string | undefined, label: string | undefined) {
  const ctx = useContext(Ctx);
  const set = ctx?.set;
  useEffect(() => {
    if (!set || !segment || !label) return;
    set(segment, label);
    return () => set(segment, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, label]);
}
