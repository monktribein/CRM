"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AvailabilityBadge } from "@/components/monitoring/admin/badges";
import { ApiError, getErrorMessage } from "@/lib/api/client";
import { monitoringAdminApi } from "@/lib/api/services";
import { formatBytes, formatInZone } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { AdminScreenshot } from "@/lib/types";

/** Loads image bytes through the authenticated API (each load is audited) and exposes an object URL. */
function useScreenshotImage(shot: AdminScreenshot | null, enabled: boolean) {
  const query = useQuery({
    queryKey: qk.adminImage(shot?.id ?? ""),
    queryFn: () => monitoringAdminApi.preview(shot!.id),
    enabled: enabled && !!shot && shot.availability === "available",
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  });
  const url = useMemo(() => (query.data ? URL.createObjectURL(query.data.blob) : null), [query.data]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return { ...query, url };
}

function unavailableText(shot: AdminScreenshot, error: unknown) {
  if (error instanceof ApiError && error.code === "file_missing") return "File missing from storage";
  if (error) return getErrorMessage(error, "Couldn't load image");
  switch (shot.availability) {
    case "pending":
      return "Upload pending";
    case "failed":
      return `Upload failed${shot.attempts ? ` after ${shot.attempts} attempt${shot.attempts === 1 ? "" : "s"}` : ""}`;
    case "missing":
      return "File missing from storage";
    case "deleted":
      return "Deleted under retention policy";
    default:
      return "Unavailable";
  }
}

/** A grid tile that loads its image only once scrolled into view. */
export function ScreenshotThumb({ shot, timeZone, onOpen, showEmployee }: { shot: AdminScreenshot; timeZone: string; onOpen: () => void; showEmployee?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(([entry]) => entry?.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  const image = useScreenshotImage(shot, visible);
  const label = `Screenshot${shot.employee ? ` of ${shot.employee.name}` : ""} captured ${formatInZone(shot.capturedAt, timeZone)}`;

  return (
    <li className="overflow-hidden rounded-lg border bg-card shadow-xs">
      <button ref={ref} type="button" onClick={onOpen} className="group block w-full text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Open ${label}`}>
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted/50">
          {image.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- private blob URL
            <img src={image.url} alt={label} className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : shot.availability === "available" && !image.error ? (
            <Skeleton className="size-full rounded-none" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-3 text-center text-xs text-muted-foreground">
              <ImageOff className="size-5" aria-hidden="true" />
              {unavailableText(shot, image.error)}
            </div>
          )}
          <AvailabilityBadge availability={image.error instanceof ApiError && image.error.code === "file_missing" ? "missing" : shot.availability} className="absolute top-2 left-2 bg-background/90 backdrop-blur" />
        </div>
        <div className="space-y-0.5 px-3 py-2">
          {showEmployee && shot.employee && <p className="truncate text-sm font-medium">{shot.employee.name} <span className="font-normal text-muted-foreground">· {shot.employee.employeeId}</span></p>}
          <p className="text-xs text-muted-foreground tabular">{formatInZone(shot.capturedAt, timeZone)}</p>
          <p className="text-xs text-muted-foreground tabular">
            {shot.width && shot.height ? `${shot.width} × ${shot.height}` : "Dimensions unknown"}
            {shot.sizeBytes ? ` · ${formatBytes(shot.sizeBytes)}` : ""}
          </p>
        </div>
      </button>
    </li>
  );
}

/** Full-size preview with keyboard/next-previous navigation and an audited download. */
export function ScreenshotPreview({
  shots,
  index,
  onIndexChange,
  timeZone,
}: {
  shots: AdminScreenshot[];
  index: number | null;
  onIndexChange: (i: number | null) => void;
  timeZone: string;
}) {
  const shot = index === null ? null : (shots[index] ?? null);
  const image = useScreenshotImage(shot, !!shot);
  const download = useMutation({
    meta: { silent: true },
    mutationFn: () => monitoringAdminApi.preview(shot!.id, true),
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: fileName ?? `${shot!.captureId}.jpg` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (e) => toast.error("Couldn't download the screenshot", { description: getErrorMessage(e) }),
  });
  const go = (d: number) => index !== null && onIndexChange(Math.min(shots.length - 1, Math.max(0, index + d)));

  return (
    <Dialog open={!!shot} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent
        className="sm:max-w-5xl"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {shot?.employee?.name ?? "Screenshot"}
            {shot && <AvailabilityBadge availability={image.error instanceof ApiError && image.error.code === "file_missing" ? "missing" : shot.availability} />}
          </DialogTitle>
          <DialogDescription className="tabular">
            {shot && (
              <>
                Captured {formatInZone(shot.capturedAt, timeZone, true)}
                {shot.width && shot.height ? ` · ${shot.width} × ${shot.height}` : ""}
                {shot.uploadedAt ? ` · uploaded ${formatInZone(shot.uploadedAt, timeZone)}` : ""}
                {` · retained until ${formatInZone(shot.expiresAt, timeZone)}`}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          {!shot ? null : image.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- private blob URL
            <img src={image.url} alt={`Screenshot captured ${formatInZone(shot.capturedAt, timeZone)}`} className="max-h-[68vh] w-auto" />
          ) : shot.availability === "available" && !image.error ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading screenshot" />
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <ImageOff className="size-8" aria-hidden="true" />
              <p className="font-medium text-foreground">{unavailableText(shot, image.error)}</p>
              {shot.lastError && <p className="max-w-lg text-xs break-words">Last error: {shot.lastError}</p>}
            </div>
          )}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={!index} onClick={() => go(-1)} aria-label="Previous screenshot"><ChevronLeft /></Button>
            <span className="px-2 text-xs text-muted-foreground tabular">{index !== null ? `${index + 1} of ${shots.length}` : ""}</span>
            <Button variant="outline" size="icon-sm" disabled={index === null || index >= shots.length - 1} onClick={() => go(1)} aria-label="Next screenshot"><ChevronRight /></Button>
          </div>
          <Button variant="outline" disabled={!shot || shot.availability !== "available" || download.isPending} onClick={() => download.mutate()}>
            {download.isPending ? <Loader2 className="animate-spin" /> : <Download />} Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
