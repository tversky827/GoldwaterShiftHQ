/**
 * Weekly schedules. A schedule is one facility × one week. Generating a week
 * turns the active staffing budget into SHIFTS (needs with N openings), in the
 * facility's local time. Assignments are separate rows, so budgeted need
 * and staffed coverage are never confused.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  departments,
  employeeAvailability,
  employeeCredentials,
  employeeFacilityAuthorizations,
  employeePositions,
  employeePreferences,
  employees,
  facilities,
  notifications,
  organizations,
  overtimeRules,
  positions,
  schedules,
  shiftAssignments,
  shifts,
  shiftTemplates,
  staffingBudgetRequirements,
  staffingBudgetTemplates,
  units,
  users,
} from "@/db/schema";
import { addDaysStr, dayOfWeek, isDateStr, localDate, weekStartOf, zonedToUtc } from "@/lib/tz";
import { audit, type AuditContext } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { paidHours } from "../facilities";
import { assertCan, can, type Actor } from "../rbac/access";
import { assignEmployee } from "./assignments";
import { weeklyHours, workweekFor } from "./hours";

export const WEEK_START_DAY = 0; // Sunday; schedule weeks match the default overtime workweek

async function facilityFor(db: Db, actor: Actor, facilityId: string) {
  const [f] = await db.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
  if (!f) throw new NotFoundError("Facility");
  return f;
}

export function normalizeWeek(date: string | undefined, timeZone: string): string {
  return weekStartOf(isDateStr(date) ? date : localDate(new Date(), timeZone), WEEK_START_DAY);
}

/** Creates the week's schedule and generates budgeted shifts. Safe to run repeatedly. */
export async function ensureWeek(db: Db, actor: Actor, ctx: AuditContext, facilityId: string, weekStart: string) {
  const f = await facilityFor(db, actor, facilityId);
  assertCan(actor, "schedules.manage", { facilityId });
  if (!isDateStr(weekStart) || dayOfWeek(weekStart) !== WEEK_START_DAY) throw new AppError("Weeks start on Sunday.");
  const weekEnd = addDaysStr(weekStart, 6);
  const [existing] = await db.select().from(schedules).where(and(eq(schedules.facilityId, facilityId), isNull(schedules.departmentId), eq(schedules.periodStart, weekStart)));
  const schedule =
    existing ??
    (
      await db
        .insert(schedules)
        .values({ facilityId, periodStart: weekStart, periodEnd: weekEnd, createdBy: actor.userId, updatedBy: actor.userId })
        .onConflictDoNothing()
        .returning()
    )[0] ??
    (await db.select().from(schedules).where(and(eq(schedules.facilityId, facilityId), isNull(schedules.departmentId), eq(schedules.periodStart, weekStart))))[0];

  const templates = await db
    .select()
    .from(staffingBudgetTemplates)
    .where(and(eq(staffingBudgetTemplates.facilityId, facilityId), eq(staffingBudgetTemplates.isActive, true), lte(staffingBudgetTemplates.effectiveFrom, weekEnd), or(isNull(staffingBudgetTemplates.effectiveTo), gte(staffingBudgetTemplates.effectiveTo, weekStart))));
  const reqs = templates.length
    ? await db
        .select({ r: staffingBudgetRequirements, st: shiftTemplates })
        .from(staffingBudgetRequirements)
        .innerJoin(shiftTemplates, eq(shiftTemplates.id, staffingBudgetRequirements.shiftTemplateId))
        .where(inArray(staffingBudgetRequirements.templateId, templates.map((t) => t.id)))
    : [];

  let created = 0;
  let updated = 0;
  const flagged: string[] = [];
  await db.transaction(async (tx) => {
    for (let i = 0; i < 7; i++) {
      const date = addDaysStr(weekStart, i);
      const dow = dayOfWeek(date);
      // One budget per department per date: the most recently effective active template wins.
      const byDept = new Map<string, (typeof templates)[number]>();
      for (const t of templates.filter((t) => t.effectiveFrom <= date && (!t.effectiveTo || t.effectiveTo >= date))) {
        const k = t.departmentId ?? "";
        const cur = byDept.get(k);
        if (!cur || t.effectiveFrom > cur.effectiveFrom) byDept.set(k, t);
      }
      for (const t of byDept.values()) {
        for (const { r, st } of reqs.filter((x) => x.r.templateId === t.id && x.r.dayOfWeek === dow)) {
          const startsAt = zonedToUtc(date, st.startTime, f.timezone);
          const endDate = st.endTime <= st.startTime ? addDaysStr(date, 1) : date;
          const endsAt = zonedToUtc(endDate, st.endTime, f.timezone);
          const [existingShift] = await tx.select().from(shifts).where(and(eq(shifts.scheduleId, schedule.id), eq(shifts.budgetRequirementId, r.id), eq(shifts.workDate, date), eq(shifts.source, "budget")));
          if (!existingShift) {
            if (r.requiredCount === 0) continue;
            await tx.insert(shifts).values({
              scheduleId: schedule.id,
              facilityId,
              departmentId: t.departmentId,
              unitId: r.unitId,
              positionId: r.positionId,
              shiftTemplateId: st.id,
              workDate: date,
              startsAt,
              endsAt,
              paidHours: String(paidHours(st.startTime, st.endTime, st.unpaidBreakMinutes)),
              requiredCount: r.requiredCount,
              source: "budget",
              budgetRequirementId: r.id,
              createdBy: actor.userId,
            }).onConflictDoNothing();
            created++;
          } else if (existingShift.requiredCount !== r.requiredCount) {
            const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, existingShift.id), eq(shiftAssignments.status, "assigned")));
            if (r.requiredCount >= n) {
              await tx.update(shifts).set({ requiredCount: r.requiredCount }).where(eq(shifts.id, existingShift.id));
              updated++;
            } else flagged.push(existingShift.id);
          }
        }
      }
    }
    if (!existing || created || updated) await audit(tx, ctx, { action: "schedule.generated", entityType: "schedule", entityId: schedule.id, facilityId, after: { weekStart, created, updated, flagged: flagged.length } });
  });
  return { schedule, created, updated, flagged };
}

export async function adjustRequired(db: Db, actor: Actor, ctx: AuditContext, shiftId: string, delta: number) {
  const [s] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
  if (!s) throw new NotFoundError("Shift");
  await facilityFor(db, actor, s.facilityId);
  assertCan(actor, "schedules.manage", { facilityId: s.facilityId, departmentId: s.departmentId ?? undefined });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, shiftId), eq(shiftAssignments.status, "assigned")));
  const next = s.requiredCount + delta;
  if (next < n) throw new AppError("Remove an assigned employee first. Openings can't go below the number already assigned.");
  if (next < 0 || next > 99) throw new AppError("That's outside the allowed range.");
  await db.transaction(async (tx) => {
    await tx.update(shifts).set({ requiredCount: next, updatedBy: actor.userId }).where(eq(shifts.id, shiftId));
    await audit(tx, ctx, { action: "shift.openings_changed", entityType: "shift", entityId: shiftId, facilityId: s.facilityId, before: { requiredCount: s.requiredCount }, after: { requiredCount: next } });
  });
}

/** Adds a need that isn't in the budget (e.g. extra CNA for a high-acuity admit). */
export async function addManualShift(db: Db, actor: Actor, ctx: AuditContext, input: { scheduleId: string; shiftTemplateId: string; positionId: string; date: string; count: number; notes?: string }) {
  const [sch] = await db.select().from(schedules).where(eq(schedules.id, input.scheduleId));
  if (!sch) throw new NotFoundError("Schedule");
  const f = await facilityFor(db, actor, sch.facilityId);
  assertCan(actor, "schedules.manage", { facilityId: f.id });
  const [st] = await db.select().from(shiftTemplates).where(and(eq(shiftTemplates.id, input.shiftTemplateId), eq(shiftTemplates.facilityId, f.id)));
  if (!st) throw new AppError("Choose a shift.");
  if (input.date < sch.periodStart || input.date > sch.periodEnd) throw new AppError("That date isn't in this week.");
  if (!(input.count >= 1 && input.count <= 20)) throw new AppError("Choose between 1 and 20 openings.");
  const startsAt = zonedToUtc(input.date, st.startTime, f.timezone);
  const endsAt = zonedToUtc(st.endTime <= st.startTime ? addDaysStr(input.date, 1) : input.date, st.endTime, f.timezone);
  return db.transaction(async (tx) => {
    const [s] = await tx
      .insert(shifts)
      .values({ scheduleId: sch.id, facilityId: f.id, positionId: input.positionId, shiftTemplateId: st.id, workDate: input.date, startsAt, endsAt, paidHours: String(paidHours(st.startTime, st.endTime, st.unpaidBreakMinutes)), requiredCount: input.count, source: "manual", notes: input.notes ?? null, createdBy: actor.userId })
      .returning();
    await audit(tx, ctx, { action: "shift.added", entityType: "shift", entityId: s.id, facilityId: f.id, after: { date: input.date, count: input.count } });
    return s;
  });
}

/**
 * Copies assignments from one week into another, matching by shift, position,
 * unit and day. Every copied assignment goes through the rules engine;
 * anything that isn't cleanly allowed is skipped and reported.
 */
export async function copyWeek(db: Db, actor: Actor, ctx: AuditContext, facilityId: string, fromWeek: string, toWeek: string) {
  const from = await ensureWeek(db, actor, ctx, facilityId, fromWeek);
  const to = await ensureWeek(db, actor, ctx, facilityId, toWeek);
  const offsetDays = Math.round((Date.parse(toWeek) - Date.parse(fromWeek)) / 86_400_000);
  const src = await db
    .select({ a: shiftAssignments, s: shifts })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .where(and(eq(shifts.scheduleId, from.schedule.id), eq(shiftAssignments.status, "assigned")));
  const targets = await db.select().from(shifts).where(and(eq(shifts.scheduleId, to.schedule.id), eq(shifts.status, "active")));
  let copied = 0;
  const skipped: string[] = [];
  for (const { a, s } of src) {
    const date = addDaysStr(s.workDate, offsetDays);
    const t = targets.find((x) => x.workDate === date && x.positionId === s.positionId && x.shiftTemplateId === s.shiftTemplateId && (x.unitId ?? null) === (s.unitId ?? null) && (x.departmentId ?? null) === (s.departmentId ?? null));
    if (!t) {
      skipped.push(`${date}: no matching shift`);
      continue;
    }
    const r = await assignEmployee(db, actor, ctx, { shiftId: t.id, employeeId: a.employeeId, via: "auto" }).catch((e: Error) => ({ status: "blocked" as const, message: e.message }));
    if (r.status === "assigned") copied++;
    else skipped.push(r.message);
  }
  await audit(db, ctx, { action: "schedule.copied", entityType: "schedule", entityId: to.schedule.id, facilityId, after: { fromWeek, toWeek, copied, skipped: skipped.length } });
  return { copied, skipped };
}

export async function publishWeek(db: Db, actor: Actor, ctx: AuditContext, scheduleId: string) {
  const [sch] = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
  if (!sch) throw new NotFoundError("Schedule");
  await facilityFor(db, actor, sch.facilityId);
  assertCan(actor, "schedules.publish", { facilityId: sch.facilityId });
  const assigned = await db
    .selectDistinct({ employeeId: shiftAssignments.employeeId })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .where(and(eq(shifts.scheduleId, scheduleId), eq(shiftAssignments.status, "assigned")));
  const linked = assigned.length ? await db.select({ id: users.id, employeeId: users.employeeId }).from(users).where(inArray(users.employeeId, assigned.map((a) => a.employeeId))) : [];
  await db.transaction(async (tx) => {
    await tx.update(schedules).set({ status: "published", publishedAt: new Date(), publishedBy: actor.userId }).where(eq(schedules.id, scheduleId));
    if (linked.length) {
      await tx.insert(notifications).values(
        linked.map((u) => ({ organizationId: actor.organizationId, userId: u.id, employeeId: u.employeeId, category: "schedule_published", title: "Your schedule is ready", body: `Your shifts for the week of ${sch.periodStart} have been published.` })),
      );
    }
    await audit(tx, ctx, { action: "schedule.published", entityType: "schedule", entityId: scheduleId, facilityId: sch.facilityId, after: { employeesNotified: linked.length } });
  });
  return { notified: linked.length };
}

/* ------------------------------------------------------------- week view */

export interface CellAssignment {
  assignmentId: string;
  employeeId: string;
  name: string;
  outcome: string;
  warnings: string[];
}
export interface Cell {
  shiftId: string;
  required: number;
  assigned: CellAssignment[];
  source: string;
  notes: string | null;
}

export async function weekView(db: Db, actor: Actor, facilityId: string, weekStart: string, filters: { departmentId?: string; positionId?: string } = {}) {
  const f = await facilityFor(db, actor, facilityId);
  assertCan(actor, "schedules.view", { facilityId });
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysStr(weekStart, i));
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.facilityId, facilityId), isNull(schedules.departmentId), eq(schedules.periodStart, weekStart)));
  const templates = await db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, facilityId)).orderBy(asc(shiftTemplates.sortOrder));
  const [depts, unitRows, posRows] = await Promise.all([
    db.select().from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.sortOrder)),
    db.select().from(units).where(eq(units.facilityId, facilityId)),
    db.select().from(positions).where(eq(positions.organizationId, actor.organizationId)).orderBy(asc(positions.sortOrder)),
  ]);
  if (!schedule) return { facility: f, schedule: null, days, rows: [], templates, departments: depts, positions: posRows, totals: { required: 0, filled: 0, open: 0 } };

  const conds = [eq(shifts.scheduleId, schedule.id), eq(shifts.status, "active")];
  if (filters.departmentId) conds.push(eq(shifts.departmentId, filters.departmentId));
  if (filters.positionId) conds.push(eq(shifts.positionId, filters.positionId));
  const shiftRows = await db.select().from(shifts).where(and(...conds));
  const assigns = shiftRows.length
    ? await db
        .select({ a: shiftAssignments, first: employees.firstName, last: employees.lastName, preferred: employees.preferredName })
        .from(shiftAssignments)
        .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
        .where(and(inArray(shiftAssignments.shiftId, shiftRows.map((s) => s.id)), eq(shiftAssignments.status, "assigned")))
    : [];

  type Row = { key: string; shiftTemplate: (typeof templates)[number] | undefined; position: (typeof posRows)[number]; unitName: string | null; cells: (Cell[] | null)[] };
  const rows = new Map<string, Row>();
  for (const s of shiftRows) {
    const key = `${s.shiftTemplateId}|${s.positionId}|${s.unitId ?? ""}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, shiftTemplate: templates.find((t) => t.id === s.shiftTemplateId), position: posRows.find((p) => p.id === s.positionId)!, unitName: unitRows.find((u) => u.id === s.unitId)?.name ?? null, cells: days.map(() => null) };
      rows.set(key, row);
    }
    const i = days.indexOf(s.workDate);
    if (i < 0) continue;
    (row.cells[i] ??= []).push({
      shiftId: s.id,
      required: s.requiredCount,
      source: s.source,
      notes: s.notes,
      assigned: assigns
        .filter((x) => x.a.shiftId === s.id)
        .map((x) => {
          const ev = x.a.ruleEvaluation as { outcome?: string; results?: { outcome: string; message: string }[] } | null;
          return { assignmentId: x.a.id, employeeId: x.a.employeeId, name: `${x.preferred ?? x.first} ${x.last}`, outcome: ev?.outcome ?? "ok", warnings: (ev?.results ?? []).filter((r) => r.outcome !== "hard_block").map((r) => r.message) };
        }),
    });
  }
  const sorted = [...rows.values()].sort((a, b) => (a.shiftTemplate?.sortOrder ?? 99) - (b.shiftTemplate?.sortOrder ?? 99) || a.position.sortOrder - b.position.sortOrder || (a.unitName ?? "").localeCompare(b.unitName ?? ""));
  const required = shiftRows.reduce((n, s) => n + s.requiredCount, 0);
  const filled = assigns.length;
  return { facility: f, schedule, days, rows: sorted, templates, departments: depts, positions: posRows, totals: { required, filled, open: Math.max(0, required - filled) } };
}

/** Staff the scheduler can place at this facility, with this week's hours across all facilities. */
export async function schedulingRoster(db: Db, actor: Actor, facilityId: string, weekStart: string, now = new Date()) {
  await facilityFor(db, actor, facilityId);
  assertCan(actor, "schedules.view", { facilityId });
  const authorizedIds = (await db.select({ id: employeeFacilityAuthorizations.employeeId }).from(employeeFacilityAuthorizations).where(and(eq(employeeFacilityAuthorizations.facilityId, facilityId), isNull(employeeFacilityAuthorizations.revokedAt)))).map((r) => r.id);
  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.organizationId, actor.organizationId), inArray(employees.employmentStatus, ["active", "leave"]), authorizedIds.length ? or(eq(employees.homeFacilityId, facilityId), inArray(employees.id, authorizedIds)) : eq(employees.homeFacilityId, facilityId)))
    .orderBy(asc(employees.lastName), asc(employees.firstName));
  const ids = emps.map((e) => e.id);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, actor.organizationId));
  const [ot] = await db.select().from(overtimeRules).where(and(eq(overtimeRules.organizationId, actor.organizationId), isNull(overtimeRules.facilityId), eq(overtimeRules.isActive, true)));
  const week = workweekFor(zonedToUtc(addDaysStr(weekStart, 1), "12:00", org.defaultTimezone), org.defaultTimezone, ot?.workweekStartDay ?? 0);
  const [hours, pos, creds, unavailable, prefs] = await Promise.all([
    weeklyHours(db, ids, week, now),
    ids.length ? db.select({ employeeId: employeePositions.employeeId, positionId: employeePositions.positionId, code: positions.code, isPrimary: employeePositions.isPrimary }).from(employeePositions).innerJoin(positions, eq(positions.id, employeePositions.positionId)).where(inArray(employeePositions.employeeId, ids)) : [],
    ids.length ? db.select({ employeeId: employeeCredentials.employeeId, status: employeeCredentials.status, expiresOn: employeeCredentials.expiresOn }).from(employeeCredentials).where(inArray(employeeCredentials.employeeId, ids)) : [],
    ids.length ? db.select().from(employeeAvailability).where(and(inArray(employeeAvailability.employeeId, ids), eq(employeeAvailability.kind, "unavailable"))) : [],
    ids.length ? db.select().from(employeePreferences).where(inArray(employeePreferences.employeeId, ids)) : [],
  ]);
  const today = localDate(now, org.defaultTimezone);
  const threshold = ot?.weeklyThresholdHours ? Number(ot.weeklyThresholdHours) : 40;
  return emps.map((e) => {
    const h = hours.get(e.id)!;
    const myCreds = creds.filter((c) => c.employeeId === e.id);
    const days = [0, 1, 2, 3, 4, 5, 6];
    return {
      id: e.id,
      name: `${e.preferredName ?? e.firstName} ${e.lastName}`,
      employmentType: e.employmentType,
      status: e.employmentStatus,
      isPool: e.isRegionalPool,
      isHome: e.homeFacilityId === facilityId,
      positions: pos.filter((p) => p.employeeId === e.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((p) => ({ id: p.positionId, code: p.code })),
      credentialIssue: myCreds.some((c) => c.status !== "verified" || (c.expiresOn && c.expiresOn < today)),
      hours: { scheduled: h.scheduled, actual: h.actual, projected: h.projected, otherFacilities: Object.entries(h.byFacility).filter(([fid]) => fid !== facilityId).reduce((n, [, v]) => n + v.scheduled, 0) },
      overtimeRisk: (h.projected > threshold ? "over" : h.projected >= threshold - 8 ? "near" : null) as "over" | "near" | null,
      unavailableDays: days.filter((d) => unavailable.some((u) => u.employeeId === e.id && u.dayOfWeek === d)),
      maxWeeklyHours: prefs.find((p) => p.employeeId === e.id)?.maxWeeklyHours ?? null,
    };
  });
}

export function canManageSchedule(actor: Actor, facilityId: string) {
  return can(actor, "schedules.manage", { facilityId });
}

