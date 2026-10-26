"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/providers/auth-provider";
import { departmentsApi, projectsApi, settingsApi, tasksApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";

const LOOKUP_STALE = 5 * 60_000;

export function useDepartments() {
  const { can } = useAuth();
  return useQuery({
    queryKey: qk.departments(),
    queryFn: () => departmentsApi.list(),
    enabled: can("departments.view"),
    staleTime: LOOKUP_STALE,
  });
}

/** The organisation's IANA timezone, used to display UTC timestamps. */
export function useOrgTimezone() {
  const { data } = useQuery({ queryKey: qk.orgSettings(), queryFn: settingsApi.organization, staleTime: LOOKUP_STALE });
  return data?.timezone ?? "UTC";
}

export function useProjects() {
  const { can } = useAuth();
  return useQuery({
    queryKey: qk.projects(),
    queryFn: () => projectsApi.list(),
    enabled: can("projects.view"),
    staleTime: LOOKUP_STALE,
  });
}

export function useAssignableUsers(enabled = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: qk.assignable(),
    queryFn: tasksApi.assignableUsers,
    enabled: enabled && can("tasks.assign"),
    staleTime: LOOKUP_STALE,
  });
}
