"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CloudUpload, ImageOff, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { EmptyState, ErrorState } from "@/components/common/states";
import { AvailabilityBadge } from "@/components/monitoring/admin/badges";
import { useOrgTimezone } from "@/hooks/use-lookups";
import { monitoringAdminApi } from "@/lib/api/services";
import { formatInZone } from "@/lib/format";
import { qk } from "@/lib/query-keys";

export default function UploadStatusPage() {
  const timeZone = useOrgTimezone();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.uploadStatus(), queryFn: monitoringAdminApi.uploads, refetchInterval: 30_000 });

  return (
    <div className="space-y-5">
      <PageHeader title="Upload & Sync Status" description={`Server-side upload state plus what employees' browsers report as still queued. Times in ${timeZone}; refreshes every 30 seconds.`} />
      {error ? (
        <div className="rounded-lg border bg-card"><ErrorState error={error} onRetry={() => refetch()} /></div>
      ) : isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
      ) : (
        <>
          <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Screenshots are stored in the CRM&apos;s MongoDB database. Individual uploads can still fail; see below.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Stored" value={data.counts.uploaded} icon={CheckCircle2} tone="success" />
            <StatCard label="Pending / uploading" value={data.counts.pending + data.counts.uploading} icon={CloudUpload} tone="info" />
            <StatCard label="Failed (awaiting retry)" value={data.counts.failed} icon={AlertTriangle} tone={data.counts.failed ? "danger" : "neutral"} />
            <StatCard label="File missing" value={data.counts.missing} icon={ImageOff} tone={data.counts.missing ? "warning" : "neutral"} />
            <StatCard label="Deleted (retention)" value={data.counts.deleted} icon={Trash2} tone="muted" />
          </div>
          {data.oldestUnsentCapturedAt && (
            <p className="text-sm text-muted-foreground">Oldest screenshot not yet stored was captured {formatInZone(data.oldestUnsentCapturedAt, timeZone)}.</p>
          )}

          <section className="overflow-hidden rounded-lg border bg-card shadow-xs" aria-labelledby="problems-heading">
            <h2 id="problems-heading" className="border-b px-4 py-2.5 text-sm font-semibold">Uploads needing attention</h2>
            {!data.problems.length ? (
              <EmptyState icon={CloudUpload} title="No failed or pending uploads" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <caption className="sr-only">Failed and pending uploads</caption>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">Employee</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Captured</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Attempts</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Last attempt</th>
                      <th scope="col" className="py-2.5 pr-4 pl-3 font-medium">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.problems.map((p) => (
                      <tr key={p.id} className="border-b last:border-0 align-top">
                        <td className="py-2.5 pr-3 pl-4">
                          <Link className="hover:text-primary hover:underline" href={`/monitoring/sessions?session=${encodeURIComponent(p.sessionId)}`}>{p.employee?.name ?? "Removed employee"}</Link>
                          <p className="text-xs text-muted-foreground">{p.employee?.employeeId}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">{formatInZone(p.capturedAt, timeZone)}</td>
                        <td className="px-3 py-2.5"><AvailabilityBadge availability={p.availability} /></td>
                        <td className="px-3 py-2.5 text-right tabular">{p.attempts}</td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap tabular">{formatInZone(p.updatedAt, timeZone)}</td>
                        <td className="max-w-md py-2.5 pr-4 pl-3 text-xs break-words text-muted-foreground">{p.lastError ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border bg-card shadow-xs" aria-labelledby="backlog-heading">
            <div className="border-b px-4 py-2.5">
              <h2 id="backlog-heading" className="text-sm font-semibold">Waiting in employees&apos; browsers</h2>
              <p className="text-xs text-muted-foreground">Reported by active sessions&apos; heartbeats. The server can&apos;t see these screenshots until they upload.</p>
            </div>
            {!data.browserBacklog.length ? (
              <EmptyState icon={CheckCircle2} title="No browser backlog reported" />
            ) : (
              <ul className="divide-y">
                {data.browserBacklog.map((b) => (
                  <li key={b.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <Link className="font-medium hover:text-primary hover:underline" href={`/monitoring/sessions?session=${encodeURIComponent(b.sessionId)}`}>{b.employee?.name ?? "Removed employee"}</Link>
                    <span className="text-xs text-muted-foreground tabular">
                      {b.clientQueue.pending} queued
                      {b.clientQueue.oldestCapturedAt ? ` · oldest ${formatInZone(b.clientQueue.oldestCapturedAt, timeZone)}` : ""}
                      {` · reported ${formatInZone(b.clientQueue.reportedAt, timeZone)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
