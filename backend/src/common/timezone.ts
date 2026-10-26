/**
 * Timestamps are stored in UTC; organisation-facing date filters are calendar
 * days in the organisation's IANA timezone. These helpers convert between the
 * two using only Intl (DST-aware, no dependencies).
 */

/** Milliseconds the zone is ahead of UTC at the given instant. */
function offsetMs(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const v = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant at which calendar day "YYYY-MM-DD" starts in the zone. */
export function zonedDayStart(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  // Two passes settle the offset across DST transitions.
  let t = wall - offsetMs(timeZone, new Date(wall));
  t = wall - offsetMs(timeZone, new Date(t));
  return new Date(t);
}

/** Inclusive calendar-day range [from, to] in the zone → half-open UTC range. */
export function zonedDayRange(timeZone: string, from?: string, to?: string) {
  const range: { $gte?: Date; $lt?: Date } = {};
  if (from) range.$gte = zonedDayStart(from, timeZone);
  if (to) {
    const next = new Date(`${to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    range.$lt = zonedDayStart(next.toISOString().slice(0, 10), timeZone);
  }
  return Object.keys(range).length ? range : undefined;
}
