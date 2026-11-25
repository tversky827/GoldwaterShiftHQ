import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { employeeFacilityAuthorizations, employees, facilities, shiftTemplates, staffingBudgetRequirements, staffingBudgetTemplates, timekeepingRecords } from "@/db/schema";
import { paidHours } from "./facilities";
import { facilityScope, type Actor } from "./rbac/access";

/**
 * Corporate overview metrics. Every number is labeled by type:
 *  - BUDGET: from staffing budget templates
 *  - ACTUAL: from timekeeping records (Attendance on Demand)
 * Scheduled/projected metrics arrive with the scheduling engine (Phase 2).
 */
export async function facilityOverview(db: Db, actor: Actor) {
  const scope = facilityScope(actor, "facilities.view");
  if (scope !== "all" && !scope.length) return { facilities: [], totals: null };
  const facWhere = scope === "all" ? eq(facilities.organizationId, actor.organizationId) : and(eq(facilities.organizationId, actor.organizationId), inArray(facilities.id, scope));
  const facs = await db.select().from(facilities).where(and(facWhere, eq(facilities.isActive, true))).orderBy(facilities.name);
  const ids = facs.map((f) => f.id);
  if (!ids.length) return { facilities: [], totals: null };
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const [staff, poolAuth, budgetRows, actual] = await Promise.all([
    db
      .select({
        facilityId: employees.homeFacilityId,
        active: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'active')::int`,
        prn: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'active' and ${employees.employmentType} = 'prn')::int`,
        leave: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'leave')::int`,
      })
      .from(employees)
      .where(inArray(employees.homeFacilityId, ids))
      .groupBy(employees.homeFacilityId),
    db
      .select({ facilityId: employeeFacilityAuthorizations.facilityId, n: sql<number>`count(distinct ${employees.id})::int` })
      .from(employeeFacilityAuthorizations)
      .innerJoin(employees, eq(employees.id, employeeFacilityAuthorizations.employeeId))
      .where(and(inArray(employeeFacilityAuthorizations.facilityId, ids), isNull(employeeFacilityAuthorizations.revokedAt), eq(employees.isRegionalPool, true), eq(employees.employmentStatus, "active")))
      .groupBy(employeeFacilityAuthorizations.facilityId),
    db
      .select({ facilityId: staffingBudgetTemplates.facilityId, count: staffingBudgetRequirements.requiredCount, start: shiftTemplates.startTime, end: shiftTemplates.endTime, brk: shiftTemplates.unpaidBreakMinutes })
      .from(staffingBudgetRequirements)
      .innerJoin(staffingBudgetTemplates, eq(staffingBudgetTemplates.id, staffingBudgetRequirements.templateId))
      .innerJoin(shiftTemplates, eq(shiftTemplates.id, staffingBudgetRequirements.shiftTemplateId))
      .where(
        and(
          inArray(staffingBudgetTemplates.facilityId, ids),
          eq(staffingBudgetTemplates.isActive, true),
          lte(staffingBudgetTemplates.effectiveFrom, today),
          or(isNull(staffingBudgetTemplates.effectiveTo), gte(staffingBudgetTemplates.effectiveTo, today)),
        ),
      ),
    db
      .select({ facilityId: timekeepingRecords.facilityId, hours: sql<number>`coalesce(sum(${timekeepingRecords.hours}), 0)::float`, records: sql<number>`count(*)::int` })
      .from(timekeepingRecords)
      .where(and(inArray(timekeepingRecords.facilityId, ids), gte(timekeepingRecords.workDate, weekAgo)))
      .groupBy(timekeepingRecords.facilityId),
  ]);

  const budget = new Map<string, number>();
  for (const b of budgetRows) budget.set(b.facilityId, (budget.get(b.facilityId) ?? 0) + b.count * paidHours(b.start, b.end, b.brk));
  const s = new Map(staff.map((x) => [x.facilityId, x]));
  const p = new Map(poolAuth.map((x) => [x.facilityId, x.n]));
  const a = new Map(actual.map((x) => [x.facilityId, x]));

  const rows = facs.map((f) => ({
    id: f.id,
    name: f.name,
    code: f.code,
    city: f.city,
    state: f.state,
    timezone: f.timezone,
    beds: f.licensedBeds,
    activeStaff: s.get(f.id)?.active ?? 0,
    prnStaff: s.get(f.id)?.prn ?? 0,
    onLeave: s.get(f.id)?.leave ?? 0,
    poolAuthorized: p.get(f.id) ?? 0,
    budgetedWeeklyHours: Math.round(budget.get(f.id) ?? 0),
    actualHoursLast7: Math.round(a.get(f.id)?.hours ?? 0),
    hasTimekeeping: (a.get(f.id)?.records ?? 0) > 0,
  }));
  const totals = rows.reduce(
    (t, r) => ({ activeStaff: t.activeStaff + r.activeStaff, budgetedWeeklyHours: t.budgetedWeeklyHours + r.budgetedWeeklyHours, actualHoursLast7: t.actualHoursLast7 + r.actualHoursLast7, prnStaff: t.prnStaff + r.prnStaff }),
    { activeStaff: 0, budgetedWeeklyHours: 0, actualHoursLast7: 0, prnStaff: 0 },
  );
  const [pool] = await db.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.organizationId, actor.organizationId), eq(employees.isRegionalPool, true), eq(employees.employmentStatus, "active")));
  return { facilities: rows, totals: { ...totals, facilities: rows.length, poolEmployees: pool.n } };
}
