/**
 * Time-zone helpers using only Intl (no dependencies).
 * Dates as "YYYY-MM-DD" strings are facility-local calendar dates.
 */

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `date` `time`.
 * Non-existent local times (spring-forward gap) resolve forward by the gap;
 * ambiguous times (fall-back) resolve to the first occurrence.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const target = `${date} ${time.slice(0, 5)}`;
  // The offset is one of the values in effect 12h before or after.
  const offsets = [...new Set([tzOffsetMs(new Date(wall - 43_200_000), timeZone), tzOffsetMs(new Date(wall + 43_200_000), timeZone)])];
  const exact = offsets.map((o) => wall - o).filter((t) => localParts(new Date(t), timeZone) === target).sort((a, b) => a - b);
  if (exact.length) return new Date(exact[0]);
  // In a spring-forward gap: use the pre-transition offset, which lands just after the gap.
  return new Date(wall - offsets[0]);
}

function localParts(d: Date, tz: string) {
  const p = partsIn(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** Facility-local calendar date of an instant. */
export function localDate(d: Date, timeZone: string): string {
  return localParts(d, timeZone).slice(0, 10);
}

export function localTime(d: Date, timeZone: string): string {
  return localParts(d, timeZone).slice(11, 16);
}

export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Start date (YYYY-MM-DD) of the week containing `date`, weeks starting on `startDay` (0=Sun). */
export function weekStartOf(date: string, startDay = 0): string {
  return addDaysStr(date, -((dayOfWeek(date) - startDay + 7) % 7));
}

export function isDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}
