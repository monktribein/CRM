"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, MonitorCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { ConsentStatus, SESSION_STATUS_LABELS, SessionStatusBadge } from "@/components/monitoring/admin/badges";
import { DateRangeFilter, DepartmentFilter, EnumFilter, SearchFilter } from "@/components/monitoring/admin/filters";
import { SessionDrawer } from "@/components/monitoring/admin/session-drawer";
import { END_REASON_LABELS } from "@/components/monitoring/monitoring-status";
import { useDebounce } from "@/hooks/use-debounce";
import { useOrgTimezone } from "@/hooks/use-lookups";
import { monitoringAdminApi } from "@/lib/api/services";
import { formatInZone } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { jobFunctionLabels } from "@/lib/roles";
import type { AdminSessionQuery, AdminSessionRow, SessionDisplayStatus, SessionSort } from "@/lib/types";

function duration(row: AdminSessionRow) {
  const end = row.endedAt ?? (row.status === "active" ? new Date().toISOString() : row.lastHeartbeatAt);
  const mins = Math.max(0, Math.round((Date.parse(end) - Date.parse(row.startedAt)) / 60_000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function SortHeader({ label, field, sort, order, onSort, className }: { label: string; field: SessionSort; sort: SessionSort; order: "asc" | "desc"; onSort: (f: SessionSort) => void; className?: string }) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={className ?? "px-3 py-2.5 font-medium"} aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        {label} <Icon className={`size-3 ${active ? "text-foreground" : "opacity-50"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

const Employee = ({ row }: { row: AdminSessionRow }) =>
  row.employee ? (
    <>
      <p className="font-medium">{row.employee.name}</p>
      <p className="text-xs text-muted-foreground">{row.employee.employeeId}</p>
    </>
  ) : (
    <span className="text-muted-foreground">Removed employee</span>
  );

/**
 * Organisation-wide session table. "logins" emphasises sign-in/out and
 * uploads; "sessions" emphasises the capture session lifecycle. Clicking a
 * row opens the session drawer (?session=<id>, so it can be linked).
 */
export function SessionsTable({ variant }: { variant: "logins" | "sessions" }) {
  const timeZone = useOrgTimezone();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openSession = params.get("session");
  const setOpenSession = (id: string | null) => router.replace(id ? `${pathname}?session=${encodeURIComponent(id)}` : pathname, { scroll: false });

  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [status, setStatus] = useState<SessionDisplayStatus | undefined>();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [sort, setSort] = useState<SessionSort>("startedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const debounced = useDebounce(search, 300);
  const reset = () => setPage(1);

  const query: AdminSessionQuery = { search: debounced || undefined, departmentId, status, ...range, sort, order, page, pageSize };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: qk.adminSessions(query),
    queryFn: () => monitoringAdminApi.sessions(query),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const onSort = (field: SessionSort) => {
    if (field === sort) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setOrder("desc");
    }
    reset();
  };
  const sortProps = { sort, order, onSort };
  const cols = 9;

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchFilter value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Search name, email or employee ID" label="Search employees" />
          <DepartmentFilter value={departmentId} onChange={(v) => { setDepartmentId(v); reset(); }} />
          <EnumFilter value={status} onChange={(v) => { setStatus(v); reset(); }} labels={SESSION_STATUS_LABELS} allLabel="All statuses" ariaLabel="Session status" />
          <DateRangeFilter {...range} timeZone={timeZone} onChange={(r) => { setRange(r); reset(); }} />
          <p className="ml-auto text-xs text-muted-foreground">Times in {timeZone}</p>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !isLoading && !data?.items.length ? (
          <EmptyState icon={MonitorCheck} title="No monitoring sessions" description="No sessions match these filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={`w-full min-w-[1080px] text-sm transition-opacity ${isFetching && !isLoading ? "opacity-70" : ""}`}>
                <caption className="sr-only">{variant === "logins" ? "Login activity" : "Monitoring sessions"}. Select a row to view its screenshots.</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">Employee</th>
                    {variant === "logins" ? (
                      <>
                        <th scope="col" className="px-3 py-2.5 font-medium">Department</th>
                        <SortHeader label="Login" field="loginAt" {...sortProps} />
                        <SortHeader label="Last heartbeat" field="lastHeartbeatAt" {...sortProps} />
                        <SortHeader label="Logout" field="endedAt" {...sortProps} />
                        <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                        <th scope="col" className="px-3 py-2.5 font-medium">Consent</th>
                        <SortHeader label="Screenshots" field="captureCount" {...sortProps} className="px-3 py-2.5 text-right font-medium" />
                        <SortHeader label="Last upload" field="lastUploadAt" {...sortProps} className="py-2.5 pr-4 pl-3 font-medium" />
                      </>
                    ) : (
                      <>
                        <SortHeader label="Started" field="startedAt" {...sortProps} />
                        <SortHeader label="Ended" field="endedAt" {...sortProps} />
                        <th scope="col" className="px-3 py-2.5 font-medium">Duration</th>
                        <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                        <th scope="col" className="px-3 py-2.5 font-medium">End reason</th>
                        <th scope="col" className="px-3 py-2.5 font-medium">Shared / policy</th>
                        <SortHeader label="Captures" field="captureCount" {...sortProps} className="px-3 py-2.5 text-right font-medium" />
                        <th scope="col" className="py-2.5 pr-4 pl-3 font-medium">Browser queue</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 8 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={cols} className="px-4 py-3"><Skeleton className="h-7" /></td></tr>)
                    : data!.items.map((r) => (
                        <tr
                          key={r.id}
                          tabIndex={0}
                          onClick={() => setOpenSession(r.id)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenSession(r.id))}
                          className={`cursor-pointer border-b last:border-0 hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none ${openSession === r.id ? "bg-primary/5" : ""}`}
                          aria-label={`Open session of ${r.employee?.name ?? "employee"} started ${formatInZone(r.startedAt, timeZone)}`}
                        >
                          <td className="py-2.5 pr-3 pl-4"><Employee row={r} /></td>
                          {variant === "logins" ? (
                            <>
                              <td className="px-3 py-2.5">
                                <p>{r.employee?.departmentName ?? "—"}</p>
                                <p className="text-xs text-muted-foreground">{r.employee ? jobFunctionLabels[r.employee.jobFunction] : ""}</p>
                              </td>
                              <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">{r.loginAt ? formatInZone(r.loginAt, timeZone) : <span className="text-muted-foreground">Unknown</span>}</td>
                              <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">{formatInZone(r.lastHeartbeatAt, timeZone)}</td>
                              <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">
                                {r.logoutAt ? formatInZone(r.logoutAt, timeZone) : <span className="text-muted-foreground">{r.status === "active" ? "—" : "Not recorded"}</span>}
                              </td>
                              <td className="px-3 py-2.5"><SessionStatusBadge status={r.displayStatus} /></td>
                              <td className="px-3 py-2.5">{r.employee ? <ConsentStatus consent={r.employee.consent} /> : "—"}</td>
                              <td className="px-3 py-2.5 text-right tabular">{r.captureCount}</td>
                              <td className="py-2.5 pr-4 pl-3 text-xs whitespace-nowrap tabular">{formatInZone(r.lastUploadAt, timeZone)}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">{formatInZone(r.startedAt, timeZone)}</td>
                              <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">{formatInZone(r.endedAt, timeZone)}</td>
                              <td className="px-3 py-2.5 text-xs tabular">{duration(r)}</td>
                              <td className="px-3 py-2.5"><SessionStatusBadge status={r.displayStatus} /></td>
                              <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.endReason ? END_REASON_LABELS[r.endReason] : "—"}</td>
                              <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.displaySurface ?? "unknown"} · v{r.policyVersion}</td>
                              <td className="px-3 py-2.5 text-right tabular">{r.captureCount}</td>
                              <td className="py-2.5 pr-4 pl-3 text-xs">
                                {r.clientQueue?.pending ? <span className="text-amber-700 dark:text-amber-300">{r.clientQueue.pending} waiting</span> : <span className="text-muted-foreground">—</span>}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); reset(); }} />}
          </>
        )}
      </div>
      <SessionDrawer sessionId={openSession} onClose={() => setOpenSession(null)} timeZone={timeZone} />
    </>
  );
}
