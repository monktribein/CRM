"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { ACCESS_ACTION_LABELS } from "@/components/monitoring/admin/badges";
import { DateRangeFilter, EnumFilter, SearchFilter } from "@/components/monitoring/admin/filters";
import { useDebounce } from "@/hooks/use-debounce";
import { useOrgTimezone } from "@/hooks/use-lookups";
import { monitoringAdminApi } from "@/lib/api/services";
import { formatInZone } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { roleMeta } from "@/lib/roles";
import type { AccessAction, AccessAuditQuery } from "@/lib/types";

export default function AccessAuditPage() {
  const timeZone = useOrgTimezone();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<AccessAction | undefined>();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);
  const query: AccessAuditQuery = { search: debounced || undefined, action, ...range, page, pageSize: 25 };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.accessLogs(query),
    queryFn: () => monitoringAdminApi.accessLogs(query),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Access Audit Logs" description={`Append-only record of who viewed, downloaded or deleted screenshots, including retention purges. Times in ${timeZone}.`} />
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchFilter value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Viewer or employee" label="Search viewer or employee" />
          <EnumFilter value={action} onChange={(v) => { setAction(v); setPage(1); }} labels={ACCESS_ACTION_LABELS} allLabel="All actions" ariaLabel="Action" />
          <DateRangeFilter {...range} timeZone={timeZone} onChange={(r) => { setRange(r); setPage(1); }} />
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !isLoading && !data?.items.length ? (
          <EmptyState icon={ShieldCheck} title="No access recorded" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <caption className="sr-only">Screenshot access audit log</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">When</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Who</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Action</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Employee</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Screenshot captured</th>
                    <th scope="col" className="py-2.5 pr-4 pl-3 font-medium">IP address</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 10 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={6} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
                    : data!.items.map((l) => (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="py-2.5 pr-3 pl-4 text-xs whitespace-nowrap tabular">{formatInZone(l.createdAt, timeZone, true)}</td>
                          <td className="px-3 py-2.5">
                            <p>{l.actor.name}</p>
                            {l.actor.role && <p className="text-xs text-muted-foreground">{roleMeta[l.actor.role].label}</p>}
                          </td>
                          <td className="px-3 py-2.5"><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{ACCESS_ACTION_LABELS[l.action]}</span></td>
                          <td className="px-3 py-2.5">
                            <Link className="hover:text-primary hover:underline" href={`/monitoring/sessions?session=${encodeURIComponent(l.sessionId)}`}>{l.employee.name}</Link>
                            {l.employee.employeeId && <p className="text-xs text-muted-foreground">{l.employee.employeeId}</p>}
                          </td>
                          <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">{formatInZone(l.capturedAt, timeZone)}</td>
                          <td className="py-2.5 pr-4 pl-3 font-mono text-xs text-muted-foreground">{l.ip ?? "—"}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
          </>
        )}
      </div>
    </div>
  );
}
