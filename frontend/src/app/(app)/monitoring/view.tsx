"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, ImageOff, Loader2, MonitorCheck, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { ConsentBadge, END_REASON_LABELS, SessionBadge, useEnrollment } from "@/components/monitoring/monitoring-status";
import { PolicyCard } from "@/components/monitoring/policy-card";
import { useAuth } from "@/components/providers/auth-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { getErrorMessage } from "@/lib/api/client";
import { monitoringApi } from "@/lib/api/services";
import { formatBytes, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { EmployeeMonitoringStatus, ScreenshotRecord } from "@/lib/types";

export default function MonitoringPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = params.get("user");
  const select = (userId: string | null) =>
    router.replace(userId ? `${pathname}?user=${encodeURIComponent(userId)}` : pathname, { scroll: false });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Screenshot Monitoring"
        description="Consent-based screen monitoring. Screenshots are taken every 5 minutes only while an enrolled employee is signed in and sharing their screen."
      />
      <PolicyCard />
      <EmployeeTable selected={selected} onSelect={select} />
      {selected && <EmployeeHistory key={selected} userId={selected} />}
    </div>
  );
}

/* ---------------- Employees ---------------- */

function EmployeeTable({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { can } = useAuth();
  const canManage = can("monitoring.manage");
  const enrollment = useEnrollment();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);
  const query = { search: debounced || undefined, page, pageSize: 20 };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.monitoringEmployees(query),
    queryFn: () => monitoringApi.employees(query),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
      <div className="flex flex-wrap gap-2 border-b p-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search employees" className="h-8 pl-8" aria-label="Search employees" />
        </div>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !isLoading && !data?.items.length ? (
        <EmptyState icon={MonitorCheck} title="No employees found" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Employee monitoring status</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">Employee</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Monitoring</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Consent</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Session</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Last capture</th>
                  <th scope="col" className="py-2.5 pr-4 pl-3 text-right font-medium">History</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={6} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
                  : data!.items.map((r: EmployeeMonitoringStatus) => (
                      <tr key={r.userId} className={`border-b last:border-0 ${selected === r.userId ? "bg-primary/5" : ""}`}>
                        <td className="py-2.5 pr-3 pl-4">
                          <p className="font-medium">{r.name}</p>
                          <p className="text-xs text-muted-foreground">{r.employeeId} · {r.email}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <Switch
                            checked={r.enabled}
                            disabled={!canManage || enrollment.isPending}
                            onCheckedChange={(enabled) => enrollment.mutate({ userId: r.userId, enabled })}
                            aria-label={`Screen monitoring for ${r.name}`}
                          />
                        </td>
                        <td className="px-3 py-2.5">{r.enabled ? <ConsentBadge consent={r.consent} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2.5"><SessionBadge session={r.latestSession} /></td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground tabular">
                          {r.lastCaptureAt ? formatDateTime(r.lastCaptureAt) : "—"}
                          {r.failedUploads > 0 && <span className="ml-2 text-destructive">{r.failedUploads} failed</span>}
                        </td>
                        <td className="py-2.5 pr-4 pl-3 text-right">
                          <Button size="sm" variant={selected === r.userId ? "secondary" : "outline"} onClick={() => onSelect(selected === r.userId ? null : r.userId)}>
                            {selected === r.userId ? "Hide" : "View"}
                          </Button>
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
  );
}

/* ---------------- History ---------------- */

function EmployeeHistory({ userId }: { userId: string }) {
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<ScreenshotRecord | null>(null);
  const sessions = useQuery({ queryKey: qk.monitoringSessions(userId), queryFn: () => monitoringApi.sessions(userId) });
  const query = { userId, sessionId, page, pageSize: 24 };
  const shots = useQuery({
    queryKey: qk.screenshots(query),
    queryFn: () => monitoringApi.screenshots(query),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <section className="rounded-lg border bg-card shadow-xs" aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className="border-b px-4 py-2.5 text-sm font-semibold">Sessions</h2>
        {sessions.error ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : sessions.isLoading ? (
          <div className="space-y-2 p-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !sessions.data?.length ? (
          <EmptyState title="No sessions yet" />
        ) : (
          <ul className="max-h-[32rem] divide-y overflow-y-auto">
            <li>
              <button type="button" onClick={() => { setSessionId(undefined); setPage(1); }} className={`w-full px-4 py-2 text-left text-sm hover:bg-muted/60 ${!sessionId ? "bg-primary/5 font-medium" : ""}`}>
                All sessions
              </button>
            </li>
            {sessions.data.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => { setSessionId(s.id); setPage(1); }} className={`w-full px-4 py-2 text-left hover:bg-muted/60 ${sessionId === s.id ? "bg-primary/5" : ""}`}>
                  <p className="text-sm tabular">{formatDateTime(s.startedAt)}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.status === "active" ? "Active now" : s.endReason ? END_REASON_LABELS[s.endReason] : "Ended"} · {s.captureCount} capture{s.captureCount === 1 ? "" : "s"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-card shadow-xs" aria-labelledby="shots-heading">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 id="shots-heading" className="text-sm font-semibold">Screenshots</h2>
          <p className="text-xs text-muted-foreground">Opening a screenshot is recorded in the activity log.</p>
        </div>
        {shots.error ? (
          <ErrorState error={shots.error} onRetry={() => shots.refetch()} />
        ) : !shots.isLoading && !shots.data?.items.length ? (
          <EmptyState icon={ImageOff} title="No screenshots" description="Nothing has been uploaded for this selection." />
        ) : (
          <>
            <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {shots.isLoading
                ? Array.from({ length: 6 }).map((_, i) => <li key={i}><Skeleton className="h-16" /></li>)
                : shots.data!.items.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm tabular">{formatDateTime(s.capturedAt)}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.status === "uploaded" ? (s.sizeBytes ? formatBytes(s.sizeBytes) : "Uploaded") : <span className="text-destructive">{s.status} · {s.attempts} attempt{s.attempts === 1 ? "" : "s"}</span>}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" disabled={s.status !== "uploaded"} onClick={() => setViewing(s)}>
                        <Eye /> View
                      </Button>
                    </li>
                  ))}
            </ul>
            {shots.data && <Pagination page={shots.data.page} pageSize={shots.data.pageSize} total={shots.data.total} onPageChange={setPage} />}
          </>
        )}
      </section>

      <ScreenshotViewer shot={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </div>
  );
}

function ScreenshotViewer({ shot, onOpenChange }: { shot: ScreenshotRecord | null; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const image = useQuery({
    queryKey: [...qk.monitoring, "image", shot?.id],
    queryFn: () => monitoringApi.screenshotImage(shot!.id),
    enabled: !!shot,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  const url = useMemo(() => (image.data ? URL.createObjectURL(image.data.blob) : null), [image.data]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const remove = useMutation({
    meta: { silent: true },
    mutationFn: () => monitoringApi.deleteScreenshot(shot!.id),
    onSuccess: () => {
      toast.success("Screenshot deleted");
      void qc.invalidateQueries({ queryKey: qk.monitoring });
      onOpenChange(false);
    },
    onError: (e) => toast.error("Couldn't delete the screenshot", { description: getErrorMessage(e) }),
  });

  return (
    <Dialog open={!!shot} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Screenshot</DialogTitle>
          <DialogDescription>
            Captured {shot ? formatDateTime(shot.capturedAt) : ""} · deleted automatically after {shot ? formatDateTime(shot.expiresAt) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          {image.error ? (
            <ErrorState error={image.error} onRetry={() => image.refetch()} />
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimisable
            <img src={url} alt={`Screenshot captured ${shot ? formatDateTime(shot.capturedAt) : ""}`} className="max-h-[70vh] w-auto" />
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading screenshot" />
          )}
        </div>
        {can("monitoring.manage") && (
          <DialogFooter>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete permanently
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
