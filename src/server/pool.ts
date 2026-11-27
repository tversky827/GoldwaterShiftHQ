/**
 * Regional staffing pool (Phase 4).
 *
 * Pool employees have no mandatory home facility. They work at any facility
 * they're authorized for, and their hours are tracked across ALL facilities
 * (one person, one record, one set of hours: never a duplicate per facility).
 *
 * Who sees what:
 *   organization-wide or pool-scoped `pool.view`  -> every facility
 *   facility-scoped `pool.view` (e.g. regional)   -> only those facilities
 * Placing pool staff: `pool.manage` (pool manager) or `schedules.manage` at the
 * facility. Every placement runs the same rules engine as any assignment.
 */
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  credentialTypes,
  employeeCredentials,
  employeeFacilityAuthorizations,
  employeePositions,
  employeePreferences,
  employees,
  facilities,
  marketplaceListings,
  organizations,
  positions,
  shiftAssignments,
  shifts,
} from "@/db/schema";
import { addDaysStr, localDate } from "@/lib/tz";
import { audit, type AuditContext } from "./audit";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { formatShift } from "./marketplace/state";
import { notify, usersForEmployees, usersWithPermission } from "./notifications";
import { can, hasOrgWide, type Actor } from "./rbac/access";
import { assignEmployee, type AssignResult } from "./scheduling/assignments";
import { weeklyHours, workweekFor } from "./scheduling/hours";
import { blockingResults, effectiveRules, evaluateAssignment } from "./scheduling/rules";

/** Facilities whose pool picture the actor may see: "all", a list, or none. */
export function poolScope(actor: Actor): "all" | string[] {
  const ids = new Set<string>();
  for (const g of actor.grants) {
    if (!g.permissions.has("pool.view")) continue;
    if (g.scopeType === "organization" || g.scopeType === "pool") return "all";
    if (g.facilityId) ids.add(g.facilityId);
  }
  return [...ids];
}

export function canSeePool(actor: Actor) {
  const s = poolScope(actor);
  return s === "all" || s.length > 0;
}

/** Can the actor place this (pool) employee into a shift at this facility? */
export function canPlacePool(actor: Actor, facilityId: string, departmentId?: string | null) {
  return hasOrgWide(actor, "pool.manage") || can(actor, "pool.manage", { pool: true }) || can(actor, "schedules.manage", { facilityId, departmentId: departmentId ?? undefined });
}

async function scopedFacilities(db: Db, actor: Actor) {
  const scope = poolScope(actor);
  if (scope !== "all" && !scope.length) throw new ForbiddenError();
  const rows = await db.select({ id: facilities.id, name: facilities.name, code: facilities.code, timezone: facilities.timezone }).from(facilities).where(and(eq(facilities.organizationId, actor.organizationId), eq(facilities.isActive, true))).orderBy(asc(facilities.name));
  return scope === "all" ? rows : rows.filter((f) => scope.includes(f.id));
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface PoolMember {
  id: string;
  name: string;
  employeeNumber: string | null;
  status: string;
  employmentType: string;
  primaryPosition: string | null;
  positionCodes: string[];
  facilities: { id: string; code: string; name: string }[];
  hours: { scheduled: number; actual: number; projected: number; byFacility: { code: string; name: string; scheduled: number; actual: number }[] };
  limit: number;
  limitSource: "preference" | "overtime";
  remaining: number;
  nextShift: { startsAt: Date; facilityName: string; facilityTimezone: string; positionCode: string } | null;
  credentialAlerts: string[];
}

/** Everything the Regional pool page shows. `weekOffset` 0 = this workweek, 1 = next. */
export async function poolDashboard(db: Db, actor: Actor, opts: { weekOffset?: number; days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const facs = await scopedFacilities(db, actor);
  const facIds = facs.map((f) => f.id);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, actor.organizationId));
  const { overtime } = await effectiveRules(db, actor.organizationId, facIds[0] ?? "00000000-0000-0000-0000-000000000000");
  const otThreshold = overtime?.weeklyThresholdHours ? Number(overtime.weeklyThresholdHours) : 40;
  const base = workweekFor(now, org.defaultTimezone, overtime?.workweekStartDay ?? 0);
  const week = opts.weekOffset ? workweekFor(new Date(base.start.getTime() + 7 * 86_400_000 * opts.weekOffset + 3_600_000), org.defaultTimezone, overtime?.workweekStartDay ?? 0) : base;

  // Pool members authorized at any in-scope facility (all pool members for "all").
  const all = poolScope(actor) === "all";
  const emps = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, actor.organizationId),
        eq(employees.isRegionalPool, true),
        inArray(employees.employmentStatus, ["active", "leave"]),
        all ? sql`true` : sql`(${employees.homeFacilityId} in (${sql.join(facIds.map((f) => sql`${f}::uuid`), sql`, `)}) or exists (select 1 from ${employeeFacilityAuthorizations} efa where efa.employee_id = ${employees.id} and efa.revoked_at is null and efa.facility_id in (${sql.join(facIds.map((f) => sql`${f}::uuid`), sql`, `)})))`,
      ),
    )
    .orderBy(asc(employees.lastName), asc(employees.firstName));
  const ids = emps.map((e) => e.id);
  const [pos, auths, prefs, hours, upcoming, creds] = await Promise.all([
    ids.length ? db.select({ employeeId: employeePositions.employeeId, code: positions.code, name: positions.name, isPrimary: employeePositions.isPrimary, positionId: positions.id }).from(employeePositions).innerJoin(positions, eq(positions.id, employeePositions.positionId)).where(inArray(employeePositions.employeeId, ids)) : [],
    ids.length ? db.select({ employeeId: employeeFacilityAuthorizations.employeeId, id: facilities.id, code: facilities.code, name: facilities.name }).from(employeeFacilityAuthorizations).innerJoin(facilities, eq(facilities.id, employeeFacilityAuthorizations.facilityId)).where(and(inArray(employeeFacilityAuthorizations.employeeId, ids), isNull(employeeFacilityAuthorizations.revokedAt))) : [],
    ids.length ? db.select().from(employeePreferences).where(inArray(employeePreferences.employeeId, ids)) : [],
    weeklyHours(db, ids, week, now),
    ids.length
      ? db
          .select({ employeeId: shiftAssignments.employeeId, startsAt: shiftAssignments.startsAt, facilityName: facilities.name, facilityTimezone: facilities.timezone, positionCode: positions.code })
          .from(shiftAssignments)
          .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
          .innerJoin(facilities, eq(facilities.id, shiftAssignments.facilityId))
          .innerJoin(positions, eq(positions.id, shifts.positionId))
          .where(and(inArray(shiftAssignments.employeeId, ids), eq(shiftAssignments.status, "assigned"), gt(shiftAssignments.startsAt, now)))
          .orderBy(asc(shiftAssignments.startsAt))
      : [],
    ids.length ? db.select({ employeeId: employeeCredentials.employeeId, name: credentialTypes.name, status: employeeCredentials.status, expiresOn: employeeCredentials.expiresOn }).from(employeeCredentials).innerJoin(credentialTypes, eq(credentialTypes.id, employeeCredentials.credentialTypeId)).where(inArray(employeeCredentials.employeeId, ids)) : [],
  ]);
  const facCode = new Map((await db.select({ id: facilities.id, code: facilities.code }).from(facilities).where(eq(facilities.organizationId, actor.organizationId))).map((f) => [f.id, f.code]));
  const today = localDate(now, org.defaultTimezone);
  const soon = addDaysStr(today, 30);

  const members: PoolMember[] = emps.map((e) => {
    const h = hours.get(e.id)!;
    const pref = prefs.find((p) => p.employeeId === e.id)?.maxWeeklyHours;
    const limit = pref ? Number(pref) : otThreshold;
    const myPos = pos.filter((p) => p.employeeId === e.id);
    const alerts = creds
      .filter((c) => c.employeeId === e.id)
      .flatMap((c) => (c.status === "revoked" ? [] : c.expiresOn && c.expiresOn < today ? [`${c.name} expired`] : c.expiresOn && c.expiresOn <= soon ? [`${c.name} expires ${c.expiresOn}`] : c.status === "pending_verification" ? [`${c.name} not verified`] : []));
    const next = upcoming.find((u) => u.employeeId === e.id);
    return {
      id: e.id,
      name: `${e.preferredName ?? e.firstName} ${e.lastName}`,
      employeeNumber: e.employeeNumber,
      status: e.employmentStatus,
      employmentType: e.employmentType,
      primaryPosition: myPos.find((p) => p.isPrimary)?.name ?? myPos[0]?.name ?? null,
      positionCodes: myPos.map((p) => p.code),
      facilities: auths.filter((a) => a.employeeId === e.id).map((a) => ({ id: a.id, code: a.code, name: a.name })).sort((a, b) => a.code.localeCompare(b.code)),
      hours: { scheduled: r1(h.scheduled), actual: r1(h.actual), projected: r1(h.projected), byFacility: Object.entries(h.byFacility).map(([fid, v]) => ({ code: facCode.get(fid) ?? "?", name: v.name, scheduled: r1(v.scheduled), actual: r1(v.actual) })).filter((x) => x.scheduled > 0 || x.actual > 0) },
      limit,
      limitSource: pref ? "preference" : "overtime",
      remaining: Math.max(0, r1(limit - r1(h.projected))),
      nextShift: next ? { startsAt: next.startsAt, facilityName: next.facilityName, facilityTimezone: next.facilityTimezone, positionCode: next.positionCode } : null,
      credentialAlerts: alerts,
    };
  });

  // Where help is needed: unfilled shifts in the next N days for positions the pool covers.
  const poolPositionIds = [...new Set(pos.map((p) => p.positionId))];
  const until = new Date(now.getTime() + (opts.days ?? 7) * 86_400_000);
  const open = facIds.length && poolPositionIds.length
    ? (
        await db
          .select({
            id: shifts.id,
            facilityId: shifts.facilityId,
            departmentId: shifts.departmentId,
            positionId: shifts.positionId,
            positionCode: positions.code,
            startsAt: shifts.startsAt,
            endsAt: shifts.endsAt,
            requiredCount: shifts.requiredCount,
            filled: sql<number>`(select count(*)::int from ${shiftAssignments} sa where sa.shift_id = ${shifts.id} and sa.status = 'assigned')`,
            listed: sql<boolean>`exists (select 1 from ${marketplaceListings} ml where ml.shift_id = ${shifts.id} and ml.status in ('scheduled','open'))`,
          })
          .from(shifts)
          .innerJoin(positions, eq(positions.id, shifts.positionId))
          .where(and(inArray(shifts.facilityId, facIds), inArray(shifts.positionId, poolPositionIds), eq(shifts.status, "active"), gt(shifts.startsAt, now), lt(shifts.startsAt, until)))
          .orderBy(asc(shifts.startsAt), asc(positions.code))
      ).filter((s) => s.filled < s.requiredCount)
    : [];
  const eligibleCount = (facilityId: string, positionId: string) =>
    members.filter((m) => m.status === "active" && pos.some((p) => p.employeeId === m.id && p.positionId === positionId) && (m.facilities.some((f) => f.id === facilityId) || emps.find((e) => e.id === m.id)?.homeFacilityId === facilityId)).length;
  const needs = open.map((s) => {
    const f = facs.find((x) => x.id === s.facilityId)!;
    return { ...s, open: s.requiredCount - s.filled, facilityName: f.name, facilityCode: f.code, facilityTimezone: f.timezone, eligiblePool: eligibleCount(s.facilityId, s.positionId), canPlace: canPlacePool(actor, s.facilityId, s.departmentId) };
  });
  const byFacility = facs
    .map((f) => {
      const n = needs.filter((x) => x.facilityId === f.id);
      return { id: f.id, code: f.code, name: f.name, openSlots: n.reduce((s, x) => s + x.open, 0), shifts: n.length, poolAuthorized: members.filter((m) => m.facilities.some((x) => x.id === f.id)).length };
    })
    .filter((f) => f.openSlots > 0 || f.poolAuthorized > 0)
    .sort((a, b) => b.openSlots - a.openSlots);

  const active = members.filter((m) => m.status === "active");
  return {
    week: { startDate: week.startDate, endDate: addDaysStr(week.startDate, 6), offset: opts.weekOffset ?? 0 },
    overtimeThreshold: otThreshold,
    rulesConfirmed: !!overtime?.confirmedAt,
    members,
    needs,
    byFacility,
    totals: {
      members: active.length,
      onLeave: members.length - active.length,
      scheduledHours: Math.round(active.reduce((s, m) => s + m.hours.scheduled, 0) * 10) / 10,
      capacityHours: Math.round(active.reduce((s, m) => s + m.remaining, 0) * 10) / 10,
      nearOvertime: active.filter((m) => m.hours.projected >= otThreshold - 4).length,
      openSlots: needs.reduce((s, n) => s + n.open, 0),
      credentialAlerts: active.filter((m) => m.credentialAlerts.length).length,
    },
    canManage: hasOrgWide(actor, "pool.manage") || can(actor, "pool.manage", { pool: true }),
  };
}

/** Pool members who could take this shift, best first, each checked by the rules engine. */
export async function poolCandidates(db: Db, actor: Actor, shiftId: string, now = new Date()) {
  const [s] = await db.select({ shift: shifts, facility: facilities }).from(shifts).innerJoin(facilities, eq(facilities.id, shifts.facilityId)).where(eq(shifts.id, shiftId));
  if (!s || s.facility.organizationId !== actor.organizationId) throw new NotFoundError("Shift");
  const scope = poolScope(actor);
  if (scope !== "all" && !scope.includes(s.facility.id)) throw new ForbiddenError();
  const rows = await db
    .select({ id: employees.id, first: employees.firstName, last: employees.lastName, preferred: employees.preferredName, home: employees.homeFacilityId })
    .from(employees)
    .innerJoin(employeePositions, and(eq(employeePositions.employeeId, employees.id), eq(employeePositions.positionId, s.shift.positionId)))
    .where(
      and(
        eq(employees.organizationId, actor.organizationId),
        eq(employees.isRegionalPool, true),
        inArray(employees.employmentStatus, ["active", "leave"]),
        sql`(${employees.homeFacilityId} = ${s.facility.id} or exists (select 1 from ${employeeFacilityAuthorizations} efa where efa.employee_id = ${employees.id} and efa.facility_id = ${s.facility.id} and efa.revoked_at is null))`,
        sql`not exists (select 1 from ${shiftAssignments} sa where sa.shift_id = ${s.shift.id} and sa.employee_id = ${employees.id} and sa.status = 'assigned')`,
      ),
    );
  const RANK = { ok: 0, warning: 1, approval_required: 2, hard_block: 3 } as const;
  const out = [];
  for (const r of rows) {
    const ev = await evaluateAssignment(db, { employeeId: r.id, shiftId, now });
    const b = blockingResults(ev);
    out.push({
      employeeId: r.id,
      name: `${r.preferred ?? r.first} ${r.last}`,
      outcome: ev.outcome,
      blocked: b.hardBlocks.length > 0,
      needsOverride: b.overridableBlocks.length > 0,
      needsApproval: b.approvals.length > 0,
      messages: ev.results.map((x) => ({ outcome: x.outcome, message: x.message })),
      hoursBefore: ev.hours.projected,
      hoursAfter: ev.hours.afterAssignment,
    });
  }
  out.sort((a, b) => RANK[a.outcome] - RANK[b.outcome] || a.hoursAfter - b.hoursAfter || a.name.localeCompare(b.name));
  return {
    shift: { id: s.shift.id, startsAt: s.shift.startsAt, endsAt: s.shift.endsAt, facilityName: s.facility.name, facilityTimezone: s.facility.timezone },
    candidates: out,
  };
}

/**
 * Places a pool employee into a shift. Uses the standard assignment service
 * (rules, overrides, approvals, database guarantees), then tells the employee
 * and the facility's schedulers.
 */
export async function placePoolEmployee(db: Db, actor: Actor, ctx: AuditContext, input: { shiftId: string; employeeId: string; explanation?: string }): Promise<AssignResult> {
  const [s] = await db.select({ shift: shifts, facility: facilities, positionCode: positions.code }).from(shifts).innerJoin(facilities, eq(facilities.id, shifts.facilityId)).innerJoin(positions, eq(positions.id, shifts.positionId)).where(eq(shifts.id, input.shiftId));
  if (!s || s.facility.organizationId !== actor.organizationId) throw new NotFoundError("Shift");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.organizationId, actor.organizationId)));
  if (!e) throw new NotFoundError("Employee");
  if (!e.isRegionalPool) throw new AppError("Only regional pool employees can be placed from here.");
  if (!canPlacePool(actor, s.facility.id, s.shift.departmentId)) throw new ForbiddenError();
  const res = await assignEmployee(db, actor, ctx, { ...input, via: "scheduler", pool: true });
  if (res.status === "assigned") {
    const when = formatShift(s.shift.startsAt, s.facility.timezone);
    await notify(db, { organizationId: actor.organizationId, userIds: await usersForEmployees(db, [e.id]), category: "pool_assignment", title: "New shift", body: `You're scheduled at ${s.facility.name}: ${s.positionCode}, ${when}.`, data: { assignmentId: res.assignmentId } });
    const schedulers = (await usersWithPermission(db, actor.organizationId, "schedules.manage", s.facility.id)).filter((u) => u !== actor.userId);
    await notify(db, { organizationId: actor.organizationId, userIds: schedulers, category: "pool_placement", title: "Pool staff placed", body: `${e.firstName} ${e.lastName} (regional pool) is covering ${s.positionCode} on ${when}.`, data: { assignmentId: res.assignmentId, facilityId: s.facility.id } });
  }
  return res;
}

/** Classify an employee into the pool and authorize facilities in one step. */
export async function addToPool(db: Db, actor: Actor, ctx: AuditContext, input: { employeeId: string; facilityIds: string[]; reason: string }) {
  if (!(hasOrgWide(actor, "pool.manage") || can(actor, "pool.manage", { pool: true }))) throw new ForbiddenError();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AppError("Please give a short reason.");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.organizationId, actor.organizationId)));
  if (!e) throw new NotFoundError("Employee");
  if (e.employmentStatus !== "active") throw new AppError("Only active employees can join the regional pool.");
  const facs = input.facilityIds.length ? await db.select().from(facilities).where(and(inArray(facilities.id, input.facilityIds), eq(facilities.organizationId, actor.organizationId))) : [];
  await db.transaction(async (tx) => {
    if (!e.isRegionalPool) {
      await tx.update(employees).set({ isRegionalPool: true, updatedBy: actor.userId }).where(eq(employees.id, e.id));
      await audit(tx, ctx, { action: "employee.pool_added", entityType: "employee", entityId: e.id, facilityId: e.homeFacilityId, before: { isRegionalPool: false }, after: { isRegionalPool: true }, reason });
    }
    const existing = await tx.select({ f: employeeFacilityAuthorizations.facilityId }).from(employeeFacilityAuthorizations).where(and(eq(employeeFacilityAuthorizations.employeeId, e.id), isNull(employeeFacilityAuthorizations.revokedAt)));
    for (const f of facs) {
      if (f.id === e.homeFacilityId || existing.some((x) => x.f === f.id)) continue;
      const [row] = await tx.insert(employeeFacilityAuthorizations).values({ employeeId: e.id, facilityId: f.id, reason, authorizedBy: actor.userId }).returning();
      await audit(tx, ctx, { action: "employee.facility_authorized", entityType: "employee", entityId: e.id, facilityId: f.id, after: { authorizationId: row.id, facility: f.name }, reason });
    }
  });
}

/** Active employees not yet in the pool (for "Add to pool"). */
export async function poolAddCandidates(db: Db, actor: Actor, q = "") {
  if (!(hasOrgWide(actor, "pool.manage") || can(actor, "pool.manage", { pool: true }))) return [];
  const term = q.trim().toLowerCase();
  return db
    .select({ id: employees.id, first: employees.firstName, last: employees.lastName, employeeNumber: employees.employeeNumber, facilityName: facilities.name, position: employees.paycorPosition })
    .from(employees)
    .leftJoin(facilities, eq(facilities.id, employees.homeFacilityId))
    .where(and(eq(employees.organizationId, actor.organizationId), eq(employees.employmentStatus, "active"), eq(employees.isRegionalPool, false), term ? sql`(lower(${employees.firstName}) like ${`%${term}%`} or lower(${employees.lastName}) like ${`%${term}%`} or ${employees.employeeNumber} = ${term})` : sql`true`, ne(employees.id, actor.employeeId ?? "00000000-0000-0000-0000-000000000000")))
    .orderBy(asc(employees.lastName), asc(employees.firstName))
    .limit(25);
}
