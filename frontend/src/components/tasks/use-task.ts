"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumb-context";
import { tasksApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";

/** Loads the task for /tasks/[id] routes and labels the breadcrumb with its key. */
export function useRouteTask() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: qk.task(id), queryFn: () => tasksApi.get(id) });
  useBreadcrumbLabel(id, query.data?.key);
  return { id, ...query };
}
