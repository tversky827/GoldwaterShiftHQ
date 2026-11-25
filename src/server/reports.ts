/**
 * Reporting (Phase 5). Every figure is labeled by where it comes from:
 *
 *   Budget     staffing budget templates (hours the facility planned for)
 *   Required   shifts actually built for the period (budget + extra/callout shifts)
 *   Scheduled  hours of people assigned to those shifts
 *   Clocked    hours punched in timekeeping (Attendance on Demand)
 *   Overtime   ESTIMATE: per person per workweek across all facilities, hours
 *              over the overtime rule's threshold (clocked hours for past days,
 *              scheduled for later), split across facilities by where they worked
 *   Fill rate  filled openings / required openings
 *   Time to fill  from when an open shift was published to when a pick-up was approved
 *
 * Periods are facility-local calendar dates, inclusive. Scope: `reports.view`.
 */
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  callouts,
  employees,
  facilities,
  marketplaceListings,
  organizations,
  positions,
  shiftAssignments,
  shiftClaims,
  shifts,
  shiftTemplates,
  staffingBudgetRequirements,
  staffingBudgetTemplates,
  timekeepingRecords,
} from "@/db/schema";
import { addDaysStr, dayOfWeek, isDateStr, localDate, weekStartOf, zonedToUtc } from "@/lib/tz";
import { AppError, ForbiddenError } from "./errors";
import { paidHours } from "./facilities";
import { facilityScope, type Actor } from "./rbac/access";
import { weeklyHours, type WeekWindow } from "./scheduling/hours";
import { effectiveRules } from "./scheduling/rules";

export type PeriodPreset = "this_week" | "last_week" | "last_4_weeks" | "last_3_months" | "custom";

export interface ReportFilter {
  preset?: PeriodPreset;
  from?: string;
  to?: string;
  facilityId?: string;
}

export interface Period {
  from: string;
  to: string;
  preset: PeriodPreset;
  label: string;
  days: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dates = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push(d);
  return out;
};
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Resolves a preset or custom range in the organization's time zone and workweek. */
export function resolvePeriod(f: ReportFilter, timeZone: string, weekStartDay: number, now = new Date()): Period {
  const today = localDate(now, timeZone);
  const thisWeek = weekStartOf(today, weekStartDay);
  let preset: PeriodPreset = f.preset ?? "last_week";
  let from: string;
  let to: string;
  if (preset === "custom") {
    if (!isDateStr(f.from) || !isDateStr(f.to) || f.from > f.to) throw new AppError("Choose a start date before the end date.");
    from = f.from;
    to = f.to;
    if (dates(from, to).length > 370) throw new AppError("Reports cover at most about a year at a time.");
  } else if (preset === "this_week") {
    from = thisWeek;
    to = addDaysStr(thisWeek, 6);
  } else if (preset === "last_4_weeks") {
    from = addDaysStr(thisWeek, -28);
    to = addDaysStr(thisWeek, -1);
  } else if (preset === "last_3_months") {
    from = addDaysStr(thisWeek, -91);
    to = addDaysStr(thisWeek, -1);
  } else {
    preset = "last_week";
    from = addDaysStr(thisWeek, -7);
    to = addDaysStr(thisWeek, -1);
  }
  return { from, to, preset, label: `${fmtDate(from)} – ${fmtDate(to)}`, days: dates(from, to).length };
}

async function context(db: Db, actor: Actor, f: ReportFilter, now = new Date()) {
  const scope = facilityScope(actor, "reports.view");
  if (scope !== "all" && !scope.length) throw new ForbiddenError();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, actor.organizationId));
  const all = await db.select().from(facilities).where(and(eq(facilities.organizationId, actor.organizationId), eq(facilities.isActive, true))).orderBy(asc(facilities.name));
  const allowed = scope === "all" ? all : all.filter((x) => scope.includes(x.id));
  const facs = f.facilityId ? allowed.filter((x) => x.id === f.facilityId) : allowed;
  if (f.facilityId && !facs.length) throw new ForbiddenError();
  const { overtime } = await effectiveRules(db, actor.organizationId, facs[0]?.id ?? all[0]?.id ?? "00000000-0000-0000-0000-000000000000");
  const period = resolvePeriod(f, org.defaultTimezone, overtime?.workweekStartDay ?? 0, now);
  return { org, facs, allowed, overtime, period, start: zonedToUtc(period.from, "00:00", org.defaultTimezone), end: zonedToUtc(addDaysStr(period.to, 1), "00:00", org.defaultTimezone) };
}

export interface FacilityReportRow {
  id: string;
  code: string;
  name: string;
  budgetHours: number;
  requiredHours: number;
  scheduledHours: number;
  clockedHours: number;
  approvedHours: number;
  requiredSlots: number;
  filledSlots: number;
  fillRate: number | null;
  scheduledVsBudget: number | null;
  clockedVsScheduled: number | null;
  overtimeHours: number;
  poolHours: number;
  listingsPublished: number;
  listingsFilled: number;
  medianHoursToFill: number | null;
  callouts: number;
  calloutsCovered: number;
  medianMinutesToCover: number | null;
}

/** The whole report: one call computes everything the page and the exports use. */
export async function laborReport(db: Db, actor: Actor, filter: ReportFilter = {}, now = new Date()) {
  const ctx = await context(db, actor, filter, now);
  const { facs, period, start, end, org, overtime } = ctx;
  const ids = facs.map((x) => x.id);
  const empty = ids.length === 0;
  const days = dates(period.from, period.to);

  // ---- Budget (templates in force on each date)
  const budgetRows = empty
    ? []
    : await db
        .select({ facilityId: staffingBudgetTemplates.facilityId, from: staffingBudgetTemplates.effectiveFrom, to: staffingBudgetTemplates.effectiveTo, dow: staffingBudgetRequirements.dayOfWeek, count: staffingBudgetRequirements.requiredCount, start: shiftTemplates.startTime, end: shiftTemplates.endTime, brk: shiftTemplates.unpaidBreakMinutes })
        .from(staffingBudgetRequirements)
        .innerJoin(staffingBudgetTemplates, eq(staffingBudgetTemplates.id, staffingBudgetRequirements.templateId))
        .innerJoin(shiftTemplates, eq(shiftTemplates.id, staffingBudgetRequirements.shiftTemplateId))
        .where(and(inArray(staffingBudgetTemplates.facilityId, ids), eq(staffingBudgetTemplates.isActive, true), lte(staffingBudgetTemplates.effectiveFrom, period.to), or(isNull(staffingBudgetTemplates.effectiveTo), gte(staffingBudgetTemplates.effectiveTo, period.from))));
  const budget = new Map<string, number>();
  for (const d of days) {
    const dow = dayOfWeek(d);
    for (const b of budgetRows) if (b.dow === dow && b.from <= d && (!b.to || b.to >= d)) budget.set(b.facilityId, (budget.get(b.facilityId) ?? 0) + b.count * paidHours(b.start, b.end, b.brk));
  }

  // ---- Shifts and coverage
  const shiftRows = empty
    ? []
    : await db
        .select({
          id: shifts.id,
          facilityId: shifts.facilityId,
          workDate: shifts.workDate,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          positionCode: positions.code,
          required: shifts.requiredCount,
          paid: shifts.paidHours,
          source: shifts.source,
          filled: sql<number>`(select count(*)::int from ${shiftAssignments} sa where sa.shift_id = ${shifts.id} and sa.status in ('assigned','completed'))`,
          poolFilled: sql<number>`(select count(*)::int from ${shiftAssignments} sa join ${employees} e on e.id = sa.employee_id where sa.shift_id = ${shifts.id} and sa.status in ('assigned','completed') and e.is_regional_pool)`,
        })
        .from(shifts)
        .innerJoin(positions, eq(positions.id, shifts.positionId))
        .where(and(inArray(shifts.facilityId, ids), eq(shifts.status, "active"), gte(shifts.workDate, period.from), lte(shifts.workDate, period.to)))
        .orderBy(asc(shifts.startsAt), asc(positions.code));

  // ---- Clocked hours
  const tk = empty
    ? []
    : await db
        .select({ facilityId: timekeepingRecords.facilityId, hours: sql<number>`coalesce(sum(${timekeepingRecords.hours}), 0)::float`, approved: sql<number>`coalesce(sum(${timekeepingRecords.hours}) filter (where ${timekeepingRecords.approved}), 0)::float` })
        .from(timekeepingRecords)
        .where(and(inArray(timekeepingRecords.facilityId, ids), gte(timekeepingRecords.workDate, period.from), lte(timekeepingRecords.workDate, period.to)))
        .groupBy(timekeepingRecords.facilityId);

  // ---- Overtime estimate: each workweek touching the period, every person who worked in scope
  const threshold = overtime?.weeklyThresholdHours ? Number(overtime.weeklyThresholdHours) : null;
  const appliesTo = overtime?.appliesToEmploymentTypes ?? [];
  const weekStarts = [...new Set(days.map((d) => weekStartOf(d, overtime?.workweekStartDay ?? 0)))];
  const otRows: { employeeId: string; name: string; employeeNumber: string | null; weekStart: string; hours: number; overtime: number; byFacility: Record<string, number> }[] = [];
  const otByFacility = new Map<string, number>();
  if (!empty && threshold !== null) {
    const people = await db
      .selectDistinct({ id: shiftAssignments.employeeId })
      .from(shiftAssignments)
      .where(and(inArray(shiftAssignments.facilityId, ids), inArray(shiftAssignments.status, ["assigned", "completed"]), lt(shiftAssignments.startsAt, end), gte(shiftAssignments.endsAt, start)));
    const clocked = await db.selectDistinct({ id: timekeepingRecords.employeeId }).from(timekeepingRecords).where(and(inArray(timekeepingRecords.facilityId, ids), gte(timekeepingRecords.workDate, period.from), lte(timekeepingRecords.workDate, period.to)));
    const empIds = [...new Set([...people.map((p) => p.id), ...clocked.map((c) => c.id).filter((x): x is string => !!x)])];
    const emps = empIds.length ? await db.select({ id: employees.id, first: employees.firstName, last: employees.lastName, num: employees.employeeNumber, type: employees.employmentType }).from(employees).where(inArray(employees.id, empIds)) : [];
    const eligible = emps.filter((e) => !appliesTo.length || appliesTo.includes(e.type));
    for (const ws of weekStarts) {
      const week: WeekWindow = { startDate: ws, timeZone: org.defaultTimezone, start: zonedToUtc(ws, "00:00", org.defaultTimezone), end: zonedToUtc(addDaysStr(ws, 7), "00:00", org.defaultTimezone) };
      const hrs = await weeklyHours(db, eligible.map((e) => e.id), week, now);
      for (const e of eligible) {
        const h = hrs.get(e.id)!;
        const ot = h.projected - threshold;
        if (ot <= 0.05) continue;
        // Split by where the person worked that week (clocked where known, else scheduled).
        const weights: Record<string, number> = {};
        for (const [fid, v] of Object.entries(h.byFacility)) weights[fid] = Math.max(v.actual, v.scheduled);
        const total = Object.values(weights).reduce((s, x) => s + x, 0) || 1;
        const byFacility: Record<string, number> = {};
        for (const [fid, w] of Object.entries(weights)) {
          byFacility[fid] = (ot * w) / total;
          if (ids.includes(fid)) otByFacility.set(fid, (otByFacility.get(fid) ?? 0) + byFacility[fid]);
        }
        otRows.push({ employeeId: e.id, name: `${e.first} ${e.last}`, employeeNumber: e.num, weekStart: ws, hours: r1(h.projected), overtime: r1(ot), byFacility });
      }
    }
  }

  // ---- Marketplace: published in the period, and pick-ups approved in the period
  const listings = empty
    ? []
    : await db
        .select({ id: marketplaceListings.id, facilityId: marketplaceListings.facilityId, status: marketplaceListings.status, publishAt: marketplaceListings.publishAt, shiftStart: shifts.startsAt, positionCode: positions.code })
        .from(marketplaceListings)
        .innerJoin(shifts, eq(shifts.id, marketplaceListings.shiftId))
        .innerJoin(positions, eq(positions.id, shifts.positionId))
        .where(and(inArray(marketplaceListings.facilityId, ids), gte(marketplaceListings.publishAt, start), lt(marketplaceListings.publishAt, end)));
  const fills = empty
    ? []
    : await db
        .select({ facilityId: marketplaceListings.facilityId, publishAt: marketplaceListings.publishAt, decidedAt: shiftClaims.decidedAt })
        .from(shiftClaims)
        .innerJoin(marketplaceListings, eq(marketplaceListings.id, shiftClaims.listingId))
        .where(and(inArray(marketplaceListings.facilityId, ids), inArray(shiftClaims.status, ["approved", "auto_approved"]), gte(shiftClaims.decidedAt, start), lt(shiftClaims.decidedAt, end)));

  // ---- Callouts reported in the period
  const cos = empty
    ? []
    : await db
        .select({ id: callouts.id, facilityId: callouts.facilityId, status: callouts.status, createdAt: callouts.createdAt, resolvedAt: callouts.resolvedAt, escalationLevel: callouts.escalationLevel, reason: callouts.reason, startsAt: shifts.startsAt, positionCode: positions.code, first: employees.firstName, last: employees.lastName })
        .from(callouts)
        .innerJoin(shiftAssignments, eq(shiftAssignments.id, callouts.assignmentId))
        .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
        .innerJoin(positions, eq(positions.id, shifts.positionId))
        .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
        .where(and(inArray(callouts.facilityId, ids), gte(callouts.createdAt, start), lt(callouts.createdAt, end)));

  const rows: FacilityReportRow[] = facs.map((f) => {
    const sh = shiftRows.filter((s) => s.facilityId === f.id);
    const requiredHours = sh.reduce((s, x) => s + x.required * Number(x.paid), 0);
    const scheduledHours = sh.reduce((s, x) => s + Math.min(x.filled, x.required) * Number(x.paid), 0);
    const requiredSlots = sh.reduce((s, x) => s + x.required, 0);
    const filledSlots = sh.reduce((s, x) => s + Math.min(x.filled, x.required), 0);
    const t = tk.find((x) => x.facilityId === f.id);
    const ls = listings.filter((l) => l.facilityId === f.id);
    const fl = fills.filter((x) => x.facilityId === f.id && x.decidedAt);
    const co = cos.filter((c) => c.facilityId === f.id);
    const covered = co.filter((c) => c.status === "covered");
    const b = budget.get(f.id) ?? 0;
    return {
      id: f.id,
      code: f.code,
      name: f.name,
      budgetHours: r1(b),
      requiredHours: r1(requiredHours),
      scheduledHours: r1(scheduledHours),
      clockedHours: r1(t?.hours ?? 0),
      approvedHours: r1(t?.approved ?? 0),
      requiredSlots,
      filledSlots,
      fillRate: pct(filledSlots, requiredSlots),
      // Ratios only where a schedule exists for the period; otherwise "no schedule", not 0%.
      scheduledVsBudget: requiredSlots ? pct(scheduledHours, b) : null,
      clockedVsScheduled: scheduledHours ? pct(t?.hours ?? 0, scheduledHours) : null,
      overtimeHours: r1(otByFacility.get(f.id) ?? 0),
      poolHours: r1(sh.reduce((s, x) => s + x.poolFilled * Number(x.paid), 0)),
      listingsPublished: ls.length,
      listingsFilled: ls.filter((l) => l.status === "filled").length,
      medianHoursToFill: (() => {
        const m = median(fl.map((x) => (x.decidedAt!.getTime() - x.publishAt.getTime()) / 3_600_000).filter((x) => x >= 0));
        return m === null ? null : r1(m);
      })(),
      callouts: co.length,
      calloutsCovered: covered.length,
      medianMinutesToCover: (() => {
        const m = median(covered.filter((c) => c.resolvedAt).map((c) => (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 60_000));
        return m === null ? null : Math.round(m);
      })(),
    };
  });

  const sum = (k: keyof FacilityReportRow, only?: (r: FacilityReportRow) => boolean) => rows.filter((r) => !only || only(r)).reduce((s, r) => s + ((r[k] as number) ?? 0), 0);
  const scheduledFacilities = (r: FacilityReportRow) => r.requiredSlots > 0;
  const allFills = fills.filter((x) => x.decidedAt).map((x) => (x.decidedAt!.getTime() - x.publishAt.getTime()) / 3_600_000).filter((x) => x >= 0);
  const allCovered = cos.filter((c) => c.status === "covered" && c.resolvedAt).map((c) => (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 60_000);
  const totals = {
    budgetHours: r1(sum("budgetHours")),
    requiredHours: r1(sum("requiredHours")),
    scheduledHours: r1(sum("scheduledHours")),
    clockedHours: r1(sum("clockedHours")),
    approvedHours: r1(sum("approvedHours")),
    requiredSlots: sum("requiredSlots"),
    filledSlots: sum("filledSlots"),
    fillRate: pct(sum("filledSlots"), sum("requiredSlots")),
    // Compare like with like: only facilities that have a schedule for the period.
    scheduledVsBudget: pct(sum("scheduledHours"), sum("budgetHours", scheduledFacilities)),
    budgetHoursScheduledFacilities: r1(sum("budgetHours", scheduledFacilities)),
    clockedVsScheduled: pct(sum("clockedHours", (r) => r.scheduledHours > 0), sum("scheduledHours")),
    clockedHoursScheduledFacilities: r1(sum("clockedHours", (r) => r.scheduledHours > 0)),
    facilitiesScheduled: rows.filter(scheduledFacilities).length,
    facilitiesTotal: rows.length,
    overtimeHours: r1(sum("overtimeHours")),
    overtimePeople: new Set(otRows.filter((o) => Object.keys(o.byFacility).some((f) => ids.includes(f))).map((o) => o.employeeId)).size,
    poolHours: r1(sum("poolHours")),
    listingsPublished: sum("listingsPublished"),
    listingsFilled: sum("listingsFilled"),
    medianHoursToFill: (() => {
      const m = median(allFills);
      return m === null ? null : r1(m);
    })(),
    callouts: sum("callouts"),
    calloutsCovered: sum("calloutsCovered"),
    medianMinutesToCover: (() => {
      const m = median(allCovered);
      return m === null ? null : Math.round(m);
    })(),
  };

  return {
    period,
    facilities: rows,
    totals,
    overtime: otRows
      .filter((o) => Object.keys(o.byFacility).some((f) => ids.includes(f)))
      .sort((a, b) => b.overtime - a.overtime)
      .map((o) => ({ ...o, facilities: Object.keys(o.byFacility).map((fid) => ctx.allowed.find((x) => x.id === fid)?.code ?? "Other").join(", ") })),
    overtimeThreshold: threshold,
    rulesConfirmed: !!overtime?.confirmedAt,
    timekeepingAvailable: tk.length > 0,
    detail: {
      shifts: shiftRows.map((s) => ({ ...s, facility: facs.find((x) => x.id === s.facilityId)!, paid: Number(s.paid) })),
      listings: listings.map((l) => ({ ...l, facility: facs.find((x) => x.id === l.facilityId)! })),
      callouts: cos.map((c) => ({ ...c, facility: facs.find((x) => x.id === c.facilityId)! })),
    },
    scope: { facilities: ctx.allowed.map((x) => ({ id: x.id, code: x.code, name: x.name })), selected: filter.facilityId ?? null },
    timeZone: org.defaultTimezone,
  };
}

export type LaborReport = Awaited<ReturnType<typeof laborReport>>;

/** This week at a glance, for the Overview page (same definitions as the report). */
export async function weekAtAGlance(db: Db, actor: Actor, now = new Date()) {
  if (facilityScope(actor, "reports.view") !== "all" && !(facilityScope(actor, "reports.view") as string[]).length) return null;
  const r = await laborReport(db, actor, { preset: "this_week" }, now);
  return { period: r.period, totals: r.totals, overtimeThreshold: r.overtimeThreshold };
}
