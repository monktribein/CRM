"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/common/states";
import { useAuth } from "@/components/providers/auth-provider";
import { getErrorMessage } from "@/lib/api/client";
import { monitoringApi } from "@/lib/api/services";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { EmployeeMonitoringStatus, MonitoringEndReason, MonitoringSession } from "@/lib/types";

export const END_REASON_LABELS: Record<MonitoringEndReason, string> = {
  logout: "Signed out",
  user_stopped: "Stopped by employee",
  stream_ended: "Sharing stopped",
  page_closed: "Tab closed",
  session_expired: "Sign-in expired",
  heartbeat_timeout: "Interrupted (no heartbeat)",
  superseded: "Replaced by new session",
  monitoring_disabled: "Monitoring disabled",
};

export function SessionBadge({ session }: { session: MonitoringSession | null }) {
  if (!session) return <span className="text-xs text-muted-foreground">Never started</span>;
  if (session.status === "active") return <Badge className="bg-emerald-600 text-white">Capturing</Badge>;
  return (
    <span className="text-xs text-muted-foreground">
      {session.endReason ? END_REASON_LABELS[session.endReason] : "Ended"} · {formatDateTime(session.endedAt ?? session.lastHeartbeatAt)}
    </span>
  );
}

export function ConsentBadge({ consent }: { consent: EmployeeMonitoringStatus["consent"] }) {
  if (consent.current) return <Badge variant="secondary">Consented v{consent.policyVersion}</Badge>;
  if (consent.decision === "declined") return <Badge variant="destructive">Declined v{consent.policyVersion}</Badge>;
  if (consent.decision === "granted") return <Badge variant="outline">Re-consent needed</Badge>;
  return <Badge variant="outline">Not yet asked</Badge>;
}

export function useEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: ({ userId, enabled }: { userId: string; enabled: boolean }) => monitoringApi.setEnrollment(userId, enabled),
    onSuccess: (row) => {
      toast.success(row.enabled ? `Monitoring enabled for ${row.name}` : `Monitoring disabled for ${row.name}`);
      void qc.invalidateQueries({ queryKey: qk.monitoring });
    },
    onError: (error) => toast.error("Couldn't update monitoring", { description: getErrorMessage(error) }),
  });
}

/** Monitoring settings and session status for one employee, opened from the employee directory. */
export function EmployeeMonitoringDialog({ employee, onOpenChange }: { employee: { id: string; name: string } | null; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const enrollment = useEnrollment();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.monitoringEmployee(employee?.id ?? ""),
    queryFn: () => monitoringApi.employee(employee!.id),
    enabled: !!employee,
  });

  return (
    <Dialog open={!!employee} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Screen monitoring</DialogTitle>
          <DialogDescription>{employee?.name}</DialogDescription>
        </DialogHeader>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <Skeleton className="h-32" />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Monitoring</dt>
            <dd className="flex items-center gap-2">
              <Switch
                checked={data.enabled}
                disabled={!can("monitoring.manage") || enrollment.isPending}
                onCheckedChange={(enabled) => enrollment.mutate({ userId: data.userId, enabled })}
                aria-label="Enable screen monitoring"
              />
              <span>{data.enabled ? (data.required ? "Enabled" : "Enabled (organisation policy is off)") : "Disabled"}</span>
            </dd>
            <dt className="text-muted-foreground">Consent</dt>
            <dd><ConsentBadge consent={data.consent} /></dd>
            <dt className="text-muted-foreground">Session</dt>
            <dd><SessionBadge session={data.latestSession} /></dd>
            <dt className="text-muted-foreground">Last capture</dt>
            <dd>{data.lastCaptureAt ? formatDateTime(data.lastCaptureAt) : "—"}</dd>
            {data.failedUploads > 0 && (
              <>
                <dt className="text-muted-foreground">Failed uploads</dt>
                <dd className="text-destructive">{data.failedUploads} awaiting retry</dd>
              </>
            )}
          </dl>
        )}
        <DialogFooter>
          {employee && (
            <Button variant="outline" asChild>
              <Link href={`/monitoring?user=${encodeURIComponent(employee.id)}`}>
                Screenshot history <ArrowRight />
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
