/**
 * Centralized, configurable eligibility rules. Evaluated before every
 * assignment (and, in Phase 3, every marketplace claim).
 *
 * Outcomes:  warning (allowed, shown) · approval_required · hard_block.
 * Rules live in `scheduling_rules` / `overtime_rules`, org-wide or per
 * facility (a facility rule of the same type replaces the org rule). Nothing
 * legal or contractual is hard-coded: default values are EXAMPLES that the
 * owner must confirm (decision A2).
 *
 * Two checks are not configurable because they protect data integrity:
 * the employee must be active, and the shift must have an open slot.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import {
  employeeAvailability,
  employeeCredentials,
  employeeFacilityAuthorizations,
  employeePositions,
  employees,
  facilities,
  organizations,
  overtimeRules,
  positionCredentialRequirements,
  credentialTypes,
  schedulingRules,
  shiftAssignments,
  shifts,
} from "@/db/schema";
import { addDaysStr, dayOfWeek, localDate, localTime } from "@/lib/tz";
import { assignmentsInRange, weeklyHours, workweekFor, type HoursBreakdown } from "./hours";

export type Outcome = "warning" | "approval_required" | "hard_block";
export type RuleType = (typeof schedulingRules.$inferSelect)["ruleType"] | "overtime" | "employee_active" | "shift_capacity";

export interface RuleResult {
  ruleType: RuleType;
  ruleId: string | null;
  name: string;
  outcome: Outcome;
  message: string;
  overridable: boolean;
}

export interface Evaluation {
  outcome: "ok" | Outcome;
  results: RuleResult[];
  hours: HoursBreakdown & { candidate: number; afterAssignment: number; overtimeThreshold: number | null };
  rulesConfirmed: boolean;
}

const RANK: Record<"ok" | Outcome, number> = { ok: 0, warning: 1, approval_required: 2, hard_block: 3 };
export const worst = (a: "ok" | Outcome, b: "ok" | Outcome) => (RANK[b] > RANK[a] ? b : a);

type SchedRule = typeof schedulingRules.$inferSelect;
type OtRule = typeof overtimeRules.$inferSelect;

/** Effective rules for a facility: facility-specific rules replace org rules of the same type. */
export async function effectiveRules(db: Db | Tx, organizationId: string, facilityId: string) {
  const rows = await db
    .select()
    .from(schedulingRules)
    .where(and(eq(schedulingRules.organizationId, organizationId), eq(schedulingRules.isActive, true), or(isNull(schedulingRules.facilityId), eq(schedulingRules.facilityId, facilityId))));
  const byType = new Map<string, SchedRule>();
  for (const r of rows.sort((a, b) => Number(!!a.facilityId) - Number(!!b.facilityId))) byType.set(r.ruleType, r);
  const ots = await db
    .select()
    .from(overtimeRules)
    .where(and(eq(overtimeRules.organizationId, organizationId), eq(overtimeRules.isActive, true), or(isNull(overtimeRules.facilityId), eq(overtimeRules.facilityId, facilityId))));
  const overtime: OtRule | undefined = ots.find((o) => o.facilityId === facilityId) ?? ots.find((o) => !o.facilityId);
  const confirmed = [...byType.values()].every((r) => r.confirmedAt) && (!overtime || !!overtime.confirmedAt);
  return { byType, overtime, confirmed };
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export interface EvaluateInput {
  employeeId: string;
  shiftId: string;
  now?: Date;
  /** Ignore this assignment (e.g. when re-evaluating an existing one). */
  ignoreAssignmentId?: string;
  /** Ignore several assignments (e.g. both sides of a shift swap). */
  ignoreAssignmentIds?: string[];
}

export async function evaluateAssignment(db: Db | Tx, input: EvaluateInput): Promise<Evaluation> {
  const now = input.now ?? new Date();
  const ignore = new Set([...(input.ignoreAssignmentIds ?? []), ...(input.ignoreAssignmentId ? [input.ignoreAssignmentId] : [])]);
  const ignoreSql = ignore.size ? sql`${shiftAssignments.id} not in (${sql.join([...ignore].map((i) => sql`${i}::uuid`), sql`, `)})` : sql`true`;
  const [row] = await db
    .select({ shift: shifts, facility: facilities, orgTz: organizations.defaultTimezone })
    .from(shifts)
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .innerJoin(organizations, eq(organizations.id, facilities.organizationId))
    .where(eq(shifts.id, input.shiftId));
  if (!row) throw new Error("Shift not found");
  const { shift, facility } = row;
  const [emp] = await db.select().from(employees).where(eq(employees.id, input.employeeId));
  if (!emp) throw new Error("Employee not found");

  const { byType, overtime, confirmed } = await effectiveRules(db, facility.organizationId, facility.id);
  const results: RuleResult[] = [];
  const add = (r: SchedRule | undefined, ruleType: RuleType, name: string, message: string, outcome?: Outcome, overridable?: boolean) =>
    results.push({ ruleType, ruleId: r?.id ?? null, name, message, outcome: outcome ?? r!.outcome, overridable: overridable ?? r?.overridable ?? false });

  // --- Always-on integrity checks
  if (emp.employmentStatus === "inactive" || emp.employmentStatus === "terminated") add(undefined, "employee_active", "Active employee", `${emp.firstName} is ${emp.employmentStatus} in Paycor.`, "hard_block", false);
  else if (emp.employmentStatus === "leave") add(undefined, "employee_active", "Active employee", `${emp.firstName} is on leave in Paycor.`, "approval_required", true);
  const [{ filled }] = await db
    .select({ filled: sql<number>`count(*)::int` })
    .from(shiftAssignments)
    .where(and(eq(shiftAssignments.shiftId, shift.id), eq(shiftAssignments.status, "assigned"), ignoreSql));
  if (shift.status !== "active") add(undefined, "shift_capacity", "Open slot", "This shift has been cancelled.", "hard_block", false);
  else if (filled >= shift.requiredCount) add(undefined, "shift_capacity", "Open slot", `This shift is fully staffed (${filled}/${shift.requiredCount}).`, "hard_block", false);

  // --- Facility authorization
  const fa = byType.get("facility_authorization");
  if (fa) {
    const [auth] = await db
      .select({ id: employeeFacilityAuthorizations.id })
      .from(employeeFacilityAuthorizations)
      .where(and(eq(employeeFacilityAuthorizations.employeeId, emp.id), eq(employeeFacilityAuthorizations.facilityId, facility.id), isNull(employeeFacilityAuthorizations.revokedAt)));
    const authorized = emp.homeFacilityId === facility.id || !!auth;
    if (!authorized) add(fa, "facility_authorization", fa.name, `${emp.firstName} isn't authorized to work at ${facility.name}.`);
  }

  // --- Position qualification
  const pq = byType.get("position_qualification");
  const empPositions = await db.select({ positionId: employeePositions.positionId }).from(employeePositions).where(eq(employeePositions.employeeId, emp.id));
  if (pq && !empPositions.some((p) => p.positionId === shift.positionId)) add(pq, "position_qualification", pq.name, `${emp.firstName} isn't classified for this position.`);

  // --- Credentials
  const cr = byType.get("credential_required");
  if (cr) {
    const required = await db
      .select({ id: credentialTypes.id, name: credentialTypes.name })
      .from(positionCredentialRequirements)
      .innerJoin(credentialTypes, eq(credentialTypes.id, positionCredentialRequirements.credentialTypeId))
      .where(eq(positionCredentialRequirements.positionId, shift.positionId));
    if (required.length) {
      const held = await db.select().from(employeeCredentials).where(and(eq(employeeCredentials.employeeId, emp.id), inArray(employeeCredentials.credentialTypeId, required.map((r) => r.id))));
      for (const req of required) {
        const c = held.filter((h) => h.credentialTypeId === req.id).sort((a, b) => (b.expiresOn ?? "9999").localeCompare(a.expiresOn ?? "9999"))[0];
        if (!c) add(cr, "credential_required", cr.name, `Missing required credential: ${req.name}.`);
        else if (c.expiresOn && c.expiresOn < shift.workDate) add(cr, "credential_required", cr.name, `${req.name} expires ${c.expiresOn}, before this shift.`);
        else if (c.status !== "verified") add(cr, "credential_required", cr.name, `${req.name} hasn't been verified yet.`);
      }
    }
  }

  // --- Overlaps, rest, daily hours, consecutive days (all facilities)
  const dayBefore = new Date(shift.startsAt.getTime() - 48 * 3_600_000);
  const dayAfter = new Date(shift.endsAt.getTime() + 48 * 3_600_000);
  const nearby = (await assignmentsInRange(db, [emp.id], dayBefore, dayAfter)).filter((a) => !ignore.has(a.id) && a.shiftId !== shift.id);
  const ov = byType.get("overlapping_shifts");
  const overlapping = nearby.filter((a) => a.startsAt < shift.endsAt && a.endsAt > shift.startsAt);
  if (ov && overlapping.length) add(ov, "overlapping_shifts", ov.name, `Overlaps another shift at ${overlapping[0].facilityName} (${fmt(overlapping[0].startsAt, overlapping[0].facilityTimezone)}).`, "hard_block", false);
  const rest = byType.get("min_rest_hours");
  if (rest) {
    const minRest = num((rest.params as Record<string, unknown>).hours, 8);
    const gaps = nearby
      .filter((a) => !(a.startsAt < shift.endsAt && a.endsAt > shift.startsAt))
      .map((a) => (a.endsAt <= shift.startsAt ? shift.startsAt.getTime() - a.endsAt.getTime() : a.startsAt.getTime() - shift.endsAt.getTime()) / 3_600_000)
      .filter((g) => g >= 0 && g < minRest);
    if (gaps.length) add(rest, "min_rest_hours", rest.name, `Only ${Math.min(...gaps).toFixed(1)} hours of rest between shifts (minimum ${minRest}).`);
  }
  const daily = byType.get("max_daily_hours");
  const tz = facility.timezone;
  const shiftDate = localDate(shift.startsAt, tz);
  if (daily) {
    const limit = num((daily.params as Record<string, unknown>).hours, 16);
    const sameDay = nearby.filter((a) => localDate(a.startsAt, tz) === shiftDate).reduce((s, a) => s + a.paidHours, 0);
    const total = sameDay + Number(shift.paidHours);
    if (total > limit) add(daily, "max_daily_hours", daily.name, `${total} hours on ${shiftDate} (limit ${limit}).`);
  }

  // --- Weekly hours, overtime and classification limits (all facilities)
  const week = workweekFor(shift.startsAt, row.orgTz, overtime?.workweekStartDay ?? 0);
  const before = (await weeklyHours(db, [emp.id], week, now)).get(emp.id)!;
  // Remove the ignored assignment's hours (re-evaluation case).
  const ignored = ignore.size ? (await assignmentsInRange(db, [emp.id], week.start, week.end)).filter((a) => ignore.has(a.id)) : [];
  const baseProjected = before.projected - ignored.reduce((s, a) => s + a.paidHours, 0);
  const candidate = Number(shift.paidHours);
  const after = Math.round((baseProjected + candidate) * 10) / 10;

  const cons = byType.get("max_consecutive_days");
  if (cons) {
    const limit = num((cons.params as Record<string, unknown>).days, 6);
    const dates = new Set((await assignmentsInRange(db, [emp.id], new Date(shift.startsAt.getTime() - 14 * 86_400_000), new Date(shift.startsAt.getTime() + 14 * 86_400_000))).filter((a) => !ignore.has(a.id)).map((a) => localDate(a.startsAt, tz)));
    dates.add(shiftDate);
    let run = 1;
    for (let d = addDaysStr(shiftDate, -1); dates.has(d); d = addDaysStr(d, -1)) run++;
    for (let d = addDaysStr(shiftDate, 1); dates.has(d); d = addDaysStr(d, 1)) run++;
    if (run > limit) add(cons, "max_consecutive_days", cons.name, `${run} consecutive working days (limit ${limit}).`);
  }
  const mw = byType.get("max_weekly_hours");
  if (mw) {
    const limit = num((mw.params as Record<string, unknown>).hours, 60);
    if (after > limit) add(mw, "max_weekly_hours", mw.name, `${after} projected hours this week across all facilities (limit ${limit}).`);
  }
  const ec = byType.get("employment_classification");
  if (ec) {
    const caps = ((ec.params as Record<string, unknown>).maxWeeklyHours ?? {}) as Record<string, number>;
    const cap = caps[emp.employmentType];
    if (cap !== undefined && after > Number(cap)) add(ec, "employment_classification", ec.name, `${after} projected hours exceeds the ${cap}-hour guideline for ${emp.employmentType.replace("_", "-")} employees.`);
  }
  let otThreshold: number | null = null;
  if (overtime && (!overtime.appliesToEmploymentTypes.length || overtime.appliesToEmploymentTypes.includes(emp.employmentType))) {
    otThreshold = overtime.weeklyThresholdHours ? Number(overtime.weeklyThresholdHours) : null;
    const warnAt = overtime.warningAtHours ? Number(overtime.warningAtHours) : null;
    if (otThreshold !== null && after > otThreshold) {
      results.push({ ruleType: "overtime", ruleId: overtime.id, name: overtime.name, outcome: overtime.outcome, overridable: overtime.overridable, message: `Creates overtime: ${after} projected hours this week across all facilities (threshold ${otThreshold}; ${Math.round((after - otThreshold) * 10) / 10} OT hours).` });
    } else if (warnAt !== null && after >= warnAt) {
      results.push({ ruleType: "overtime", ruleId: overtime.id, name: overtime.name, outcome: "warning", overridable: true, message: `Approaching overtime: ${after} projected hours this week (threshold ${otThreshold ?? "—"}).` });
    }
  }

  // --- Availability
  const av = byType.get("availability");
  if (av) {
    const dow = dayOfWeek(shiftDate);
    const entries = await db
      .select()
      .from(employeeAvailability)
      .where(and(eq(employeeAvailability.employeeId, emp.id), eq(employeeAvailability.kind, "unavailable"), or(eq(employeeAvailability.dayOfWeek, dow), eq(employeeAvailability.specificDate, shiftDate))));
    const startT = localTime(shift.startsAt, tz);
    const blocked = entries.find((e) => !e.startTime || !e.endTime || (startT >= e.startTime.slice(0, 5) && startT < e.endTime.slice(0, 5)));
    if (blocked) add(av, "availability", av.name, `${emp.firstName} marked ${blocked.specificDate ?? ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][dow]} as unavailable.`);
  }

  const outcome = results.reduce<"ok" | Outcome>((o, r) => worst(o, r.outcome), "ok");
  return { outcome, results, hours: { ...before, candidate, afterAssignment: after, overtimeThreshold: otThreshold }, rulesConfirmed: confirmed };
}

function fmt(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}

/** Can the actor proceed past these results? */
export function blockingResults(ev: Evaluation) {
  return {
    hardBlocks: ev.results.filter((r) => r.outcome === "hard_block" && !r.overridable),
    overridableBlocks: ev.results.filter((r) => r.outcome === "hard_block" && r.overridable),
    approvals: ev.results.filter((r) => r.outcome === "approval_required"),
    warnings: ev.results.filter((r) => r.outcome === "warning"),
  };
}
