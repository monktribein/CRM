"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { UserLabel } from "@/components/common/user-avatar";
import { useDebounce } from "@/hooks/use-debounce";
import { activityApi } from "@/lib/api/services";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { ActivityEntity, ActivityQuery } from "@/lib/types";

const ALL = "__all__";
const ENTITY_LABELS: Record<ActivityEntity, string> = {
  task: "Task",
  user: "Employee",
  project: "Project",
  department: "Department",
  auth: "Sign-in",
  settings: "Settings",
};

export default function ActivityPage() {
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState<ActivityEntity | undefined>();
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);
  const query: ActivityQuery = { search: debounced || undefined, entityType, page, pageSize: 25 };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.activity(query),
    queryFn: () => activityApi.list(query),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Activity Logs" description="Append-only audit trail of important changes. Entries can't be edited or deleted." />
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search actor or description" className="h-8 pl-8" aria-label="Search activity" />
          </div>
          <Select value={entityType ?? ALL} onValueChange={(v) => { setEntityType(v === ALL ? undefined : (v as ActivityEntity)); setPage(1); }}>
            <SelectTrigger size="sm" className="w-40" aria-label="Entity type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All activity</SelectItem>
              {Object.entries(ENTITY_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !isLoading && !data?.items.length ? (
          <EmptyState icon={History} title="No activity found" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Activity log</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">When</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Actor</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
                    <th scope="col" className="py-2.5 pr-4 pl-3 font-medium">Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 10 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={4} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
                    : data!.items.map((a) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="py-2.5 pr-3 pl-4 text-xs whitespace-nowrap text-muted-foreground tabular">{formatDateTime(a.createdAt)}</td>
                          <td className="px-3 py-2.5"><UserLabel user={a.actor} /></td>
                          <td className="px-3 py-2.5"><span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{ENTITY_LABELS[a.entityType]}</span></td>
                          <td className="py-2.5 pr-4 pl-3">
                            {a.entityType === "task" && a.entityId ? (
                              <Link href={`/tasks/${a.entityId}`} className="hover:text-primary hover:underline">{a.description}</Link>
                            ) : (
                              a.description
                            )}
                            <span className="ml-2 font-mono text-[11px] text-muted-foreground">{a.action}</span>
                          </td>
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
