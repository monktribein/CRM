import { CheckCircle2, CircleAlert, CircleDashed, CircleOff, Clock, ImageOff, Radio, ShieldCheck, ShieldQuestion, ShieldX, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccessAction, MonitoredEmployee, ScreenshotAvailability, SessionDisplayStatus } from "@/lib/types";

const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3";

const SESSION: Record<SessionDisplayStatus, { label: string; className: string; icon: typeof Radio; hint: string }> = {
  active: { label: "Active", icon: Radio, className: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300", hint: "Capturing now" },
  ended: { label: "Ended", icon: CheckCircle2, className: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300", hint: "Confirmed logout or stopped by the employee" },
  expired: { label: "Expired", icon: Clock, className: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300", hint: "Heartbeats stopped (browser closed, computer asleep or offline). Exact logout time unknown." },
  interrupted: { label: "Interrupted", icon: CircleAlert, className: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-300", hint: "Sharing stopped, tab closed, replaced by a new session or monitoring disabled. Not a confirmed logout." },
};

export function SessionStatusBadge({ status }: { status: SessionDisplayStatus }) {
  const s = SESSION[status];
  return (
    <span className={cn(pill, s.className)} title={s.hint}>
      <s.icon aria-hidden="true" /> {s.label}
    </span>
  );
}

export const SESSION_STATUS_LABELS = Object.fromEntries(Object.entries(SESSION).map(([k, v]) => [k, v.label])) as Record<SessionDisplayStatus, string>;

const AVAILABILITY: Record<ScreenshotAvailability, { label: string; className: string; icon: typeof Radio }> = {
  available: { label: "Stored", icon: CheckCircle2, className: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" },
  pending: { label: "Upload pending", icon: CircleDashed, className: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300" },
  failed: { label: "Upload failed", icon: CircleAlert, className: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300" },
  missing: { label: "File missing", icon: ImageOff, className: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-300" },
  deleted: { label: "Deleted", icon: Trash2, className: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400" },
};

export function AvailabilityBadge({ availability, className }: { availability: ScreenshotAvailability; className?: string }) {
  const a = AVAILABILITY[availability];
  return (
    <span className={cn(pill, a.className, className)}>
      <a.icon aria-hidden="true" /> {a.label}
    </span>
  );
}

export const AVAILABILITY_LABELS = Object.fromEntries(Object.entries(AVAILABILITY).map(([k, v]) => [k, v.label])) as Record<ScreenshotAvailability, string>;

export function ConsentStatus({ consent }: { consent: MonitoredEmployee["consent"] }) {
  if (consent.current) {
    return <span className={cn(pill, "border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300")}><ShieldCheck aria-hidden="true" /> Consented v{consent.policyVersion}</span>;
  }
  if (consent.decision === "declined") {
    return <span className={cn(pill, "border-red-200 text-red-800 dark:border-red-900 dark:text-red-300")}><ShieldX aria-hidden="true" /> Declined v{consent.policyVersion}</span>;
  }
  if (consent.decision === "granted") {
    return <span className={cn(pill, "border-amber-200 text-amber-800 dark:border-amber-900 dark:text-amber-300")}><ShieldQuestion aria-hidden="true" /> Outdated (v{consent.policyVersion})</span>;
  }
  return <span className={cn(pill, "text-muted-foreground")}><CircleOff aria-hidden="true" /> Not recorded</span>;
}

export const ACCESS_ACTION_LABELS: Record<AccessAction, string> = {
  previewed: "Viewed",
  downloaded: "Downloaded",
  deleted: "Deleted",
  retention_purged: "Purged (retention)",
};
