/**
 * Staffing budgets: how many of each position are needed per shift, per day
 * of week (optionally per unit), with effective dates. Budgets describe NEED;
 * they never contain employee assignments.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { departments, facilities, facilityPositions, positions, shiftTemplates, staffingBudgetRequirements, staffingBudgetTemplates, units } from "@/db/schema";
import { isDateStr } from "@/lib/tz";
import { audit, type AuditContext } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { paidHours } from "../facilities";
import { assertCan, type Actor } from "../rbac/access";

export const budgetTemplateInput = z
  .object({
    name: z.string().trim().min(2, "Enter a name.").max(80),
    departmentId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    effectiveFrom: z.string().refine(isDateStr, "Choose a start date."),
    effectiveTo: z.string().refine(isDateStr, "Choose a valid date.").optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { path: ["effectiveTo"], message: "End date must be after the start date." });

async function templateWithFacility(db: Db, actor: Actor, templateId: string) {
  const [t] = await db.select({ t: staffingBudgetTemplates, f: facilities }).from(staffingBudgetTemplates).innerJoin(facilities, eq(facilities.id, staffingBudgetTemplates.facilityId)).where(eq(staffingBudgetTemplates.id, templateId));
  if (!t || t.f.organizationId !== actor.organizationId) throw new NotFoundError("Staffing budget");
  return t;
}

export async function createBudgetTemplate(db: Db, actor: Actor, ctx: AuditContext, facilityId: string, input: z.infer<typeof budgetTemplateInput>) {
  assertCan(actor, "budgets.manage", { facilityId });
  const [f] = await db.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
  if (!f) throw new NotFoundError("Facility");
  if (input.departmentId) {
    const [d] = await db.select().from(departments).where(and(eq(departments.id, input.departmentId), eq(departments.facilityId, facilityId)));
    if (!d) throw new AppError("That department isn't part of this facility.");
  }
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(staffingBudgetTemplates)
      .values({ facilityId, departmentId: input.departmentId ?? null, name: input.name, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, createdBy: actor.userId, updatedBy: actor.userId })
      .returning();
    await audit(tx, ctx, { action: "budget.created", entityType: "staffing_budget", entityId: t.id, facilityId, after: t });
    return t;
  });
}

export async function updateBudgetTemplate(db: Db, actor: Actor, ctx: AuditContext, templateId: string, input: z.infer<typeof budgetTemplateInput> & { isActive: boolean }) {
  const { t } = await templateWithFacility(db, actor, templateId);
  assertCan(actor, "budgets.manage", { facilityId: t.facilityId });
  await db.transaction(async (tx) => {
    const values = { name: input.name, departmentId: input.departmentId ?? null, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, isActive: input.isActive, updatedBy: actor.userId };
    await tx.update(staffingBudgetTemplates).set(values).where(eq(staffingBudgetTemplates.id, templateId));
    await audit(tx, ctx, { action: "budget.updated", entityType: "staffing_budget", entityId: templateId, facilityId: t.facilityId, before: t, after: values });
  });
}

/** Editor data: every active shift × enabled position × unit row, with counts per day. */
export async function budgetEditorData(db: Db, actor: Actor, templateId: string) {
  const { t, f } = await templateWithFacility(db, actor, templateId);
  assertCan(actor, "budgets.view", { facilityId: t.facilityId });
  const [shiftsRows, posRows, unitRows, reqs] = await Promise.all([
    db.select().from(shiftTemplates).where(and(eq(shiftTemplates.facilityId, t.facilityId), eq(shiftTemplates.isActive, true))).orderBy(asc(shiftTemplates.sortOrder)),
    db.select({ p: positions }).from(facilityPositions).innerJoin(positions, eq(positions.id, facilityPositions.positionId)).where(eq(facilityPositions.facilityId, t.facilityId)).orderBy(asc(positions.sortOrder)),
    t.departmentId ? db.select().from(units).where(and(eq(units.departmentId, t.departmentId), eq(units.isActive, true))).orderBy(asc(units.sortOrder)) : Promise.resolve([]),
    db.select().from(staffingBudgetRequirements).where(eq(staffingBudgetRequirements.templateId, templateId)),
  ]);
  const count = (unitId: string | null, positionId: string, shiftTemplateId: string, dow: number) =>
    reqs.find((r) => (r.unitId ?? null) === unitId && r.positionId === positionId && r.shiftTemplateId === shiftTemplateId && r.dayOfWeek === dow)?.requiredCount ?? 0;
  const usesUnits = reqs.some((r) => r.unitId);
  // Keep the grid focused: positions matching the department type, plus any row already in use.
  const [dept] = t.departmentId ? await db.select().from(departments).where(eq(departments.id, t.departmentId)) : [];
  const inUse = new Set(reqs.filter((r) => r.requiredCount > 0).map((r) => r.positionId));
  const shownPositions = posRows.filter(({ p }) => inUse.has(p.id) || !dept || p.isClinical === dept.isClinical);
  const unitList: ({ id: string; name: string } | null)[] = usesUnits ? unitRows.map((u) => ({ id: u.id, name: u.name })) : [null];
  let weeklyHours = 0;
  const sections = shiftsRows.map((s) => {
    const ph = paidHours(s.startTime, s.endTime, s.unpaidBreakMinutes);
    const rows = unitList.flatMap((u) =>
      shownPositions.map(({ p }) => {
        const days = [0, 1, 2, 3, 4, 5, 6].map((d) => count(u?.id ?? null, p.id, s.id, d));
        weeklyHours += days.reduce((a, b) => a + b, 0) * ph;
        return { unitId: u?.id ?? null, unitName: u?.name ?? null, positionId: p.id, positionCode: p.code, positionName: p.name, days };
      }),
    );
    return { shift: { id: s.id, code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime, paidHours: ph }, rows };
  });
  return { template: t, facility: f, sections, usesUnits, units: unitRows, weeklyHours: Math.round(weeklyHours) };
}

export interface MatrixCell {
  unitId: string | null;
  positionId: string;
  shiftTemplateId: string;
  dayOfWeek: number;
  requiredCount: number;
}

/** Saves the full matrix. Rows are updated in place (existing shifts reference them). */
export async function saveBudgetMatrix(db: Db, actor: Actor, ctx: AuditContext, templateId: string, cells: MatrixCell[]) {
  const { t } = await templateWithFacility(db, actor, templateId);
  assertCan(actor, "budgets.manage", { facilityId: t.facilityId });
  for (const c of cells) {
    if (!Number.isInteger(c.requiredCount) || c.requiredCount < 0 || c.requiredCount > 99) throw new AppError("Staffing counts must be whole numbers between 0 and 99.");
    if (c.dayOfWeek < 0 || c.dayOfWeek > 6) throw new AppError("Invalid day.");
  }
  const validShifts = new Set((await db.select({ id: shiftTemplates.id }).from(shiftTemplates).where(eq(shiftTemplates.facilityId, t.facilityId))).map((s) => s.id));
  if (cells.some((c) => !validShifts.has(c.shiftTemplateId))) throw new AppError("A shift in this budget doesn't belong to the facility.");
  let changed = 0;
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(staffingBudgetRequirements).where(eq(staffingBudgetRequirements.templateId, templateId));
    const key = (c: { unitId: string | null; positionId: string; shiftTemplateId: string; dayOfWeek: number }) => `${c.unitId ?? ""}|${c.positionId}|${c.shiftTemplateId}|${c.dayOfWeek}`;
    const byKey = new Map(existing.map((e) => [key(e), e]));
    for (const c of cells) {
      const cur = byKey.get(key(c));
      if (cur) {
        if (cur.requiredCount !== c.requiredCount) {
          await tx.update(staffingBudgetRequirements).set({ requiredCount: c.requiredCount }).where(eq(staffingBudgetRequirements.id, cur.id));
          changed++;
        }
      } else if (c.requiredCount > 0) {
        await tx.insert(staffingBudgetRequirements).values({ templateId, unitId: c.unitId, positionId: c.positionId, shiftTemplateId: c.shiftTemplateId, dayOfWeek: c.dayOfWeek, requiredCount: c.requiredCount });
        changed++;
      }
    }
    if (changed) await audit(tx, ctx, { action: "budget.matrix_updated", entityType: "staffing_budget", entityId: templateId, facilityId: t.facilityId, after: { cellsChanged: changed } });
  });
  return changed;
}

/**
 * Copies a budget to another facility. Positions are shared org-wide (and get
 * enabled at the target). Shifts are matched by code; missing ones are created
 * with the same times. Units are not copied (facility-specific).
 */
export async function copyBudgetTemplate(db: Db, actor: Actor, ctx: AuditContext, templateId: string, targetFacilityId: string, name?: string) {
  const { t, f } = await templateWithFacility(db, actor, templateId);
  assertCan(actor, "budgets.view", { facilityId: t.facilityId });
  assertCan(actor, "budgets.manage", { facilityId: targetFacilityId });
  const [target] = await db.select().from(facilities).where(and(eq(facilities.id, targetFacilityId), eq(facilities.organizationId, actor.organizationId)));
  if (!target) throw new NotFoundError("Facility");
  const reqs = await db.select().from(staffingBudgetRequirements).where(eq(staffingBudgetRequirements.templateId, templateId));
  const srcShifts = await db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, t.facilityId));
  const [srcDept] = t.departmentId ? await db.select().from(departments).where(eq(departments.id, t.departmentId)) : [];

  return db.transaction(async (tx) => {
    const tgtShifts = await tx.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, targetFacilityId));
    const shiftMap = new Map<string, string>();
    for (const s of srcShifts) {
      let match = tgtShifts.find((x) => x.code === s.code);
      if (!match) [match] = await tx.insert(shiftTemplates).values({ facilityId: targetFacilityId, code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime, unpaidBreakMinutes: s.unpaidBreakMinutes, sortOrder: s.sortOrder, createdBy: actor.userId }).returning();
      shiftMap.set(s.id, match.id);
    }
    const posIds = [...new Set(reqs.map((r) => r.positionId))];
    if (posIds.length) {
      const enabled = new Set((await tx.select().from(facilityPositions).where(and(eq(facilityPositions.facilityId, targetFacilityId), inArray(facilityPositions.positionId, posIds)))).map((p) => p.positionId));
      const add = posIds.filter((p) => !enabled.has(p));
      if (add.length) await tx.insert(facilityPositions).values(add.map((positionId) => ({ facilityId: targetFacilityId, positionId })));
    }
    let deptId: string | null = null;
    if (srcDept) {
      const [d] = await tx.select().from(departments).where(and(eq(departments.facilityId, targetFacilityId), eq(departments.name, srcDept.name)));
      deptId = d?.id ?? null;
    }
    const [copy] = await tx
      .insert(staffingBudgetTemplates)
      .values({ facilityId: targetFacilityId, departmentId: deptId, name: name?.trim() || `${t.name} (from ${f.code})`, effectiveFrom: t.effectiveFrom, effectiveTo: t.effectiveTo, copiedFromId: t.id, isActive: false, createdBy: actor.userId, updatedBy: actor.userId })
      .returning();
    // Merge per (position, shift, day): units aren't copied, so their counts are summed.
    const merged = new Map<string, { positionId: string; shiftTemplateId: string; dayOfWeek: number; requiredCount: number }>();
    for (const r of reqs) {
      const k = `${r.positionId}|${shiftMap.get(r.shiftTemplateId)}|${r.dayOfWeek}`;
      const cur = merged.get(k) ?? { positionId: r.positionId, shiftTemplateId: shiftMap.get(r.shiftTemplateId)!, dayOfWeek: r.dayOfWeek, requiredCount: 0 };
      cur.requiredCount += r.requiredCount;
      merged.set(k, cur);
    }
    if (merged.size) await tx.insert(staffingBudgetRequirements).values([...merged.values()].map((m) => ({ ...m, templateId: copy.id, unitId: null })));
    await audit(tx, ctx, { action: "budget.copied", entityType: "staffing_budget", entityId: copy.id, facilityId: targetFacilityId, after: { from: t.id, fromFacility: f.name, requirements: merged.size } });
    return copy;
  });
}

export async function listBudgetTemplates(db: Db, actor: Actor, facilityId: string) {
  assertCan(actor, "budgets.view", { facilityId });
  return db.select().from(staffingBudgetTemplates).where(eq(staffingBudgetTemplates.facilityId, facilityId)).orderBy(asc(staffingBudgetTemplates.effectiveFrom));
}
