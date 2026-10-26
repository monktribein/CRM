import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

export function formatDate(iso: string | null | undefined, pattern = "MMM d, yyyy") {
  if (!iso) return "—";
  return format(parseISO(iso), pattern);
}

/**
 * Calendar-day fields (start/due/join dates) are stored as UTC day boundaries
 * (e.g. due = 23:59:59.999Z). Read them by their UTC date so a browser in
 * another timezone never shows the neighbouring day.
 */
export function dayOf(iso: string) {
  return parseISO(iso.slice(0, 10));
}

export function formatDay(iso: string | null | undefined, pattern = "MMM d, yyyy") {
  if (!iso) return "—";
  return format(dayOf(iso), pattern);
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return format(parseISO(iso), "MMM d, yyyy 'at' h:mm a");
}

/**
 * Formats a UTC instant in an explicit IANA timezone (e.g. the organisation's),
 * independent of the viewer's browser zone. Includes the zone abbreviation.
 */
export function formatInZone(iso: string | null | undefined, timeZone: string, withSeconds = false) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return formatDateTime(iso);
  }
}

export function formatRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  return `${formatDistanceToNowStrict(parseISO(iso))} ago`;
}

export function formatHours(hours: number) {
  if (!Number.isFinite(hours)) return "—";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** yyyy-MM-dd for <input type="date"> values. */
export function toDateInput(date: Date) {
  return format(date, "yyyy-MM-dd");
}
