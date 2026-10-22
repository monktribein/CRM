"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TaskPriority, TaskQuery, TaskScope, TaskSortField, TaskStatus } from "@/lib/types";

export type TaskView = "table" | "board" | "calendar";

const list = <T extends string>(v: string | null) => (v ? (v.split(",").filter(Boolean) as T[]) : undefined);

/** Task list state lives in the URL so views are shareable and survive reloads. */
export function useTaskQueryState(scope: TaskScope) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const view = (params.get("view") as TaskView | null) ?? "table";

  const query = useMemo<TaskQuery>(
    () => ({
      scope,
      search: params.get("search") ?? undefined,
      status: list<TaskStatus>(params.get("status")),
      priority: list<TaskPriority>(params.get("priority")),
      departmentId: params.get("departmentId") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      assigneeId: params.get("assigneeId") ?? undefined,
      overdue: params.get("overdue") === "true" || undefined,
      sort: (params.get("sort") as TaskSortField | null) ?? "dueDate",
      order: (params.get("order") as "asc" | "desc" | null) ?? "asc",
      page: Number(params.get("page") ?? 1) || 1,
      pageSize: Number(params.get("pageSize") ?? 20) || 20,
    }),
    [params, scope]
  );

  const update = useCallback(
    (patch: Record<string, string | number | boolean | string[] | null | undefined>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        const value = Array.isArray(v) ? v.join(",") : v === undefined || v === null || v === false ? "" : String(v);
        if (value) next.set(k, value);
        else next.delete(k);
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );

  const activeFilterCount =
    (query.status?.length ? 1 : 0) +
    (query.priority?.length ? 1 : 0) +
    (query.departmentId ? 1 : 0) +
    (query.projectId ? 1 : 0) +
    (query.assigneeId ? 1 : 0) +
    (query.overdue ? 1 : 0);

  const clearFilters = () =>
    update({ status: null, priority: null, departmentId: null, projectId: null, assigneeId: null, overdue: null, search: null });

  return { query, view, update, activeFilterCount, clearFilters };
}
