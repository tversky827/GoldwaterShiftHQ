/** Display helpers. Instants are stored in UTC and shown in the facility's time zone. */
export function formatDateTime(d: Date | string | null | undefined, timeZone?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(d));
}

export function formatDate(d: Date | string | null | undefined, timeZone?: string): string {
  if (!d) return "—";
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`) : new Date(d);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: typeof d === "string" && d.length === 10 ? "UTC" : timeZone }).format(date);
}

export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
}

export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (Math.abs(diff) < 60) return "just now";
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  prn: "PRN",
  temporary: "Temporary",
  unknown: "Not specified",
};

export const STATUS_LABEL: Record<string, string> = { active: "Active", inactive: "Inactive", terminated: "Terminated", leave: "On leave" };

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
}

export function timezoneShort(tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}
