/** Workweek helpers. FLSA workweek assumed Sunday 00:00 - Saturday 23:59 (local). Confirm with payroll. */
export const WORKWEEK_START_DAY = 0; // 0 = Sunday

export function startOfWorkweek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() - WORKWEEK_START_DAY + 7) % 7));
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function at(day: Date, hour: number, minute = 0): string {
  const x = new Date(day);
  x.setHours(hour, minute, 0, 0);
  return x.toISOString();
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 3_600_000;
}
