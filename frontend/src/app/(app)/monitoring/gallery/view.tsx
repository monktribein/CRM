"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common/page-header";
import { ALL, DepartmentFilter } from "@/components/monitoring/admin/filters";
import { ScreenshotGrid } from "@/components/monitoring/admin/screenshot-grid";
import { useOrgTimezone } from "@/hooks/use-lookups";
import { monitoringApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";

export default function ScreenshotGalleryPage() {
  const timeZone = useOrgTimezone();
  const params = useSearchParams();
  const [userId, setUserId] = useState<string | undefined>(params.get("user") ?? undefined);
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const employees = useQuery({
    queryKey: qk.monitoringEmployees({ page: 1, search: "__all__" }),
    queryFn: () => monitoringApi.employees({ page: 1, pageSize: 200 }),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Screenshot Gallery" description={`All screenshots in the organisation, newest first. Times in ${timeZone}.`} />
      <ScreenshotGrid
        key={`${userId ?? ""}:${departmentId ?? ""}`}
        scope={{ userId, departmentId }}
        timeZone={timeZone}
        showEmployee
        toolbar={
          <>
            <Select value={userId ?? ALL} onValueChange={(v) => setUserId(v === ALL ? undefined : v)}>
              <SelectTrigger size="sm" className="w-52" aria-label="Employee"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All employees</SelectItem>
                {employees.data?.items.map((e) => <SelectItem key={e.userId} value={e.userId}>{e.name} ({e.employeeId})</SelectItem>)}
              </SelectContent>
            </Select>
            <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
          </>
        }
      />
    </div>
  );
}
