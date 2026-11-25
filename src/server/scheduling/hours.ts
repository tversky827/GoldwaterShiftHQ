/**
 * Employee hours for a workweek, across ALL facilities. Four separate measures:
 *  - actual:    hours clocked (timekeeping / Attendance on Demand)
 *  - approved:  clocked hours marked approved in timekeeping
 *  - scheduled: paid hours of active assignments
 *  - projected: for past days, actual hours where clocked (otherwise the
 *               scheduled hours); for today and later, scheduled hours.
 *               This is what overtime rules evaluate.
 * The workweek uses the organization's time zone and the overtime rule's
 * workweek start day (confirm both with payroll).
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { facilities, shiftAssignments, shifts, timekeepingRecords } from "@/db/schema";
import { addDaysStr, localDate, weekStartOf, zonedToUtc } from "@/lib/tz";

export interface WeekWindow {
  start: Date;
  end: Date;
  startDate: string;
  timeZone: string;
}

export function workweekFor(instant: Date, timeZone: string, startDay = 0): WeekWindow {
  const startDate = weekStartOf(localDate(instant, timeZone), startDay);
  return { startDate, timeZone, start: zonedToUtc(startDate, "00:00", timeZone), end: zonedToUtc(addDaysStr(startDate, 7), "00:00", timeZone) };
}

export interface HoursBreakdown {
  actual: number;
  approved: number;
  scheduled: number;
  projected: number;
  byFacility: Record<string, { name: string; scheduled: number; actual: number }>;
  /** Local dates with an active assignment (for consecutive-day rules). */
  workedDates: string[];
}

export interface AssignmentSlice {
  id: string;
  employeeId: string;
  shiftId: string;
  facilityId: string;
  facilityName: string;
  facilityTimezone: string;
  startsAt: Date;
  endsAt: Date;
  paidHours: number;
}

/** Active assignments for employees in [from, to) across every facility. */
export async function assignmentsInRange(db: Db | Tx, employeeIds: string[], from: Date, to: Date): Promise<AssignmentSlice[]> {
  if (!employeeIds.length) return [];
  const rows = await db
    .select({
      id: shiftAssignments.id,
      employeeId: shiftAssignments.employeeId,
      shiftId: shiftAssignments.shiftId,
      facilityId: shiftAssignments.facilityId,
      facilityName: facilities.name,
      facilityTimezone: facilities.timezone,
      startsAt: shiftAssignments.startsAt,
      endsAt: shiftAssignments.endsAt,
      paidHours: shifts.paidHours,
    })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .innerJoin(facilities, eq(facilities.id, shiftAssignments.facilityId))
    .where(and(inArray(shiftAssignments.employeeId, employeeIds), inArray(shiftAssignments.status, ["assigned", "completed"]), lt(shiftAssignments.startsAt, to), gte(shiftAssignments.endsAt, from)));
  return rows.map((r) => ({ ...r, paidHours: Number(r.paidHours) }));
}

export async function weeklyHours(db: Db | Tx, employeeIds: string[], week: WeekWindow, now = new Date(), extra?: { employeeId: string; startsAt: Date; paidHours: number; facilityId: string; facilityName: string }): Promise<Map<string, HoursBreakdown>> {
  const out = new Map<string, HoursBreakdown>();
  for (const id of employeeIds) out.set(id, { actual: 0, approved: 0, scheduled: 0, projected: 0, byFacility: {}, workedDates: [] });
  if (!employeeIds.length) return out;
  const [assigns, tk] = await Promise.all([
    assignmentsInRange(db, employeeIds, week.start, week.end),
    db
      .select({ employeeId: timekeepingRecords.employeeId, workDate: timekeepingRecords.workDate, punchIn: timekeepingRecords.punchIn, punchOut: timekeepingRecords.punchOut, hours: timekeepingRecords.hours, approved: timekeepingRecords.approved, facilityId: timekeepingRecords.facilityId })
      .from(timekeepingRecords)
      .where(and(inArray(timekeepingRecords.employeeId, employeeIds), gte(timekeepingRecords.workDate, week.startDate), lt(timekeepingRecords.workDate, addDaysStr(week.startDate, 7)))),
  ]);
  const today = localDate(now, week.timeZone);
  const perDay = new Map<string, { scheduled: number; actual: number; hasActual: boolean }>();
  const key = (e: string, d: string) => `${e}|${d}`;

  const slices = assigns.filter((a) => a.startsAt >= week.start && a.startsAt < week.end);
  if (extra && out.has(extra.employeeId) && extra.startsAt >= week.start && extra.startsAt < week.end) {
    slices.push({ id: "candidate", employeeId: extra.employeeId, shiftId: "", facilityId: extra.facilityId, facilityName: extra.facilityName, facilityTimezone: week.timeZone, startsAt: extra.startsAt, endsAt: extra.startsAt, paidHours: extra.paidHours });
  }
  for (const a of slices) {
    const b = out.get(a.employeeId)!;
    const d = localDate(a.startsAt, week.timeZone);
    b.scheduled += a.paidHours;
    (b.byFacility[a.facilityId] ??= { name: a.facilityName, scheduled: 0, actual: 0 }).scheduled += a.paidHours;
    if (!b.workedDates.includes(d)) b.workedDates.push(d);
    const pd = perDay.get(key(a.employeeId, d)) ?? { scheduled: 0, actual: 0, hasActual: false };
    pd.scheduled += a.paidHours;
    perDay.set(key(a.employeeId, d), pd);
  }
  for (const t of tk) {
    if (!t.employeeId) continue;
    const b = out.get(t.employeeId)!;
    const h = t.hours != null ? Number(t.hours) : t.punchIn && t.punchOut ? (t.punchOut.getTime() - t.punchIn.getTime()) / 3_600_000 : 0;
    b.actual += h;
    if (t.approved) b.approved += h;
    if (t.facilityId) (b.byFacility[t.facilityId] ??= { name: "", scheduled: 0, actual: 0 }).actual += h;
    const pd = perDay.get(key(t.employeeId, t.workDate)) ?? { scheduled: 0, actual: 0, hasActual: false };
    pd.actual += h;
    pd.hasActual = true;
    perDay.set(key(t.employeeId, t.workDate), pd);
  }
  for (const [k, pd] of perDay) {
    const [emp, d] = k.split("|");
    const b = out.get(emp)!;
    b.projected += d < today ? (pd.hasActual ? pd.actual : pd.scheduled) : pd.scheduled;
  }
  for (const b of out.values()) {
    for (const f of ["actual", "approved", "scheduled", "projected"] as const) b[f] = Math.round(b[f] * 100) / 100;
    b.workedDates.sort();
  }
  return out;
}
