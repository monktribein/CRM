"use client";

import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { ConsentStatus, SessionStatusBadge } from "@/components/monitoring/admin/badges";
import { ScreenshotGrid } from "@/components/monitoring/admin/screenshot-grid";
import { END_REASON_LABELS } from "@/components/monitoring/monitoring-status";
import { monitoringAdminApi } from "@/lib/api/services";
import { formatInZone } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { jobFunctionLabels } from "@/lib/roles";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 tabular">{children}</dd>
    </>
  );
}

/** Session details with that session's screenshots in capture order. */
export function SessionDrawer({ sessionId, onClose, timeZone }: { sessionId: string | null; onClose: () => void; timeZone: string }) {
  const { data: s, isLoading, error, refetch } = useQuery({
    queryKey: qk.adminSession(sessionId ?? ""),
    queryFn: () => monitoringAdminApi.session(sessionId!),
    enabled: !!sessionId,
  });

  return (
    <Sheet open={!!sessionId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl lg:data-[side=right]:max-w-5xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {s?.employee?.name ?? "Monitoring session"}
            {s && <SessionStatusBadge status={s.displayStatus} />}
          </SheetTitle>
          <SheetDescription>
            {s?.employee ? `${s.employee.employeeId} · ${s.employee.departmentName ?? "No department"} · ${jobFunctionLabels[s.employee.jobFunction]}` : "Session details"}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : isLoading || !s ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
                <Row label="Signed in">{formatInZone(s.loginAt, timeZone)}</Row>
                <Row label="Sharing started">{formatInZone(s.startedAt, timeZone)}</Row>
                <Row label="Last heartbeat">{formatInZone(s.lastHeartbeatAt, timeZone)}</Row>
                <Row label="Logout">
                  {s.logoutAt ? formatInZone(s.logoutAt, timeZone) : <span className="text-muted-foreground">{s.status === "active" ? "—" : "Not recorded"}</span>}
                </Row>
                <Row label="Ended">
                  {s.endedAt ? `${formatInZone(s.endedAt, timeZone)}` : "—"}
                  {s.endReason && <span className="block text-xs text-muted-foreground">{END_REASON_LABELS[s.endReason]}{s.displayStatus === "expired" ? " — time of last heartbeat" : ""}</span>}
                </Row>
                <Row label="Consent">{s.employee ? <ConsentStatus consent={s.employee.consent} /> : "—"}</Row>
                <Row label="Screenshots">
                  {s.captureCount} uploaded
                  {s.screenshotCounts.failed ? <span className="text-destructive"> · {s.screenshotCounts.failed} failed</span> : null}
                  {s.screenshotCounts.pending || s.screenshotCounts.uploading ? <span> · {(s.screenshotCounts.pending ?? 0) + (s.screenshotCounts.uploading ?? 0)} pending</span> : null}
                  {s.screenshotCounts.deleted ? <span className="text-muted-foreground"> · {s.screenshotCounts.deleted} deleted</span> : null}
                </Row>
                <Row label="Last upload">{formatInZone(s.lastUploadAt, timeZone)}</Row>
                <Row label="Shared surface">{s.displaySurface ?? "Unknown"}</Row>
                <Row label="Policy version">v{s.policyVersion}</Row>
                {s.clientQueue && s.clientQueue.pending > 0 && (
                  <Row label="Browser queue">
                    {s.clientQueue.pending} waiting in the employee&apos;s browser (reported {formatInZone(s.clientQueue.reportedAt, timeZone)})
                  </Row>
                )}
              </dl>
              <p className="text-xs text-muted-foreground">Times shown in {timeZone}.</p>
              <ScreenshotGrid key={s.id} scope={{ sessionId: s.id }} timeZone={timeZone} pageSize={12} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
