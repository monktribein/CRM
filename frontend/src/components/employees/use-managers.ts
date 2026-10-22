"use client";

import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import type { EmployeeQuery } from "@/lib/types";

const MANAGER_QUERY: EmployeeQuery = {
  role: ["manager", "hr_manager", "admin", "super_admin"],
  status: "active",
  page: 1,
  pageSize: 200,
};

/** Active users who can act as a reporting manager. */
export function useManagers(enabled = true) {
  return useQuery({
    queryKey: qk.userList(MANAGER_QUERY),
    queryFn: () => usersApi.list(MANAGER_QUERY),
    enabled,
    staleTime: 60_000,
    select: (d) => d.items,
  });
}
