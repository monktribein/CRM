"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ImageOff, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { AVAILABILITY_LABELS } from "@/components/monitoring/admin/badges";
import { DateRangeFilter, EnumFilter } from "@/components/monitoring/admin/filters";
import { ScreenshotPreview, ScreenshotThumb } from "@/components/monitoring/admin/screenshot-media";
import { monitoringAdminApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import type { AdminScreenshotQuery, ScreenshotAvailability } from "@/lib/types";

/**
 * Thumbnail grid with date/availability filters, pagination and a preview
 * modal. `scope` fixes the employee/session/department; it comes from the
 * page, and the API re-checks the organisation boundary on every request.
 */
export function ScreenshotGrid({
  scope,
  timeZone,
  showEmployee = false,
  pageSize = 24,
  toolbar,
}: {
  scope: Pick<AdminScreenshotQuery, "sessionId" | "userId" | "departmentId">;
  timeZone: string;
  showEmployee?: boolean;
  pageSize?: number;
  toolbar?: React.ReactNode;
}) {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [availability, setAvailability] = useState<ScreenshotAvailability | undefined>();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const query: AdminScreenshotQuery = { ...scope, ...range, availability, page, pageSize };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.adminScreenshots(query),
    queryFn: () => monitoringAdminApi.screenshots(query),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {toolbar}
        <DateRangeFilter {...range} timeZone={timeZone} onChange={(r) => { setRange(r); setPage(1); }} />
        <EnumFilter value={availability} onChange={(v) => { setAvailability(v); setPage(1); }} labels={AVAILABILITY_LABELS} allLabel="Any status" ariaLabel="Upload status" />
        <p className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> Every image you load is recorded in the access audit log.
        </p>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !isLoading && !data?.items.length ? (
        <EmptyState icon={ImageOff} title="No screenshots" description="Nothing matches these filters." />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy={isLoading}>
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => <li key={i}><Skeleton className="aspect-video rounded-lg" /><Skeleton className="mt-2 h-8" /></li>)
              : data!.items.map((s, i) => <ScreenshotThumb key={s.id} shot={s} timeZone={timeZone} showEmployee={showEmployee} onOpen={() => setOpen(i)} />)}
          </ul>
          {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(p) => { setPage(p); setOpen(null); }} />}
        </>
      )}
      <ScreenshotPreview shots={data?.items ?? []} index={open} onIndexChange={setOpen} timeZone={timeZone} />
    </div>
  );
}
