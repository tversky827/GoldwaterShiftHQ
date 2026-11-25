import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { departments, employees, facilities, facilityPositions, positions, shiftTemplates, staffingBudgetRequirements, staffingBudgetTemplates, units } from "@/db/schema";
import { audit, diff, type AuditContext } from "./audit";
import { AppError, NotFoundError } from "./errors";
import { assertCan, facilityScope, type Actor } from "./rbac/access";

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Detroit", label: "Eastern (Detroit)" },
  { value: "America/Indiana/Indianapolis", label: "Eastern (Indianapolis)" },
  { value: "America/Kentucky/Louisville", label: "Eastern (Louisville)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Boise", label: "Mountain (Boise)" },
  { value: "America/Phoenix", label: "Mountain – no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

const opt = z.string().trim().max(200).optional().transform((v) => (v ? v : null));

export const facilityInput = z.object({
  name: z.string().trim().min(2, "Enter the facility name.").max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Use 2–10 letters or numbers.")
    .max(10, "Use 2–10 letters or numbers.")
    .regex(/^[A-Z0-9-]+$/, "Use letters, numbers or dashes."),
  addressLine1: opt,
  addressLine2: opt,
  city: opt,
  state: z.string().trim().toUpperCase().max(2).optional().transform((v) => (v ? v : null)),
  postalCode: z.string().trim().max(10).optional().transform((v) => (v ? v : null)),
  phone: opt,
  timezone: z.string().refine((v) => Intl.supportedValuesOf("timeZone").includes(v), "Choose a valid time zone."),
  licensedBeds: z.coerce.number().int().min(0).max(2000).optional().or(z.literal("").transform(() => undefined)),
});
export type FacilityInput = z.infer<typeof facilityInput>;

export async function listFacilities(db: Db, actor: Actor) {
  const scope = facilityScope(actor, "facilities.view");
  if (scope !== "all" && scope.length === 0) return [];
  const where = scope === "all" ? eq(facilities.organizationId, actor.organizationId) : and(eq(facilities.organizationId, actor.organizationId), inArray(facilities.id, scope));
  const rows = await db.select().from(facilities).where(where).orderBy(asc(facilities.name));
  const counts = await db
    .select({ facilityId: employees.homeFacilityId, n: count() })
    .from(employees)
    .where(and(eq(employees.organizationId, actor.organizationId), eq(employees.employmentStatus, "active")))
    .groupBy(employees.homeFacilityId);
  const deptCounts = await db.select({ facilityId: departments.facilityId, n: count() }).from(departments).groupBy(departments.facilityId);
  const byF = new Map(counts.map((c) => [c.facilityId, c.n]));
  const byD = new Map(deptCounts.map((c) => [c.facilityId, c.n]));
  return rows.map((f) => ({ ...f, activeEmployees: byF.get(f.id) ?? 0, departmentCount: byD.get(f.id) ?? 0 }));
}

export async function getFacility(db: Db, actor: Actor, facilityId: string) {
  assertCan(actor, "facilities.view", { facilityId });
  const [f] = await db.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
  if (!f) throw new NotFoundError("Facility");
  const [depts, unitRows, enabled, allPositions, templates] = await Promise.all([
    db.select().from(departments).where(eq(departments.facilityId, f.id)).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select().from(units).where(eq(units.facilityId, f.id)).orderBy(asc(units.sortOrder), asc(units.name)),
    db.select({ positionId: facilityPositions.positionId }).from(facilityPositions).where(eq(facilityPositions.facilityId, f.id)),
    db.select().from(positions).where(eq(positions.organizationId, actor.organizationId)).orderBy(asc(positions.sortOrder), asc(positions.name)),
    db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, f.id)).orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.startTime)),
  ]);
  const enabledIds = new Set(enabled.map((e) => e.positionId));
  return {
    facility: f,
    departments: depts.map((d) => ({ ...d, units: unitRows.filter((u) => u.departmentId === d.id) })),
    positions: allPositions.map((p) => ({ ...p, enabled: enabledIds.has(p.id) })),
    shiftTemplates: templates.map((t) => ({ ...t, paidHours: paidHours(t.startTime, t.endTime, t.unpaidBreakMinutes) })),
  };
}

export async function createFacility(db: Db, actor: Actor, ctx: AuditContext, input: FacilityInput) {
  assertCan(actor, "facilities.manage");
  if (!actor.grants.some((g) => g.scopeType === "organization" && g.permissions.has("facilities.manage"))) {
    throw new AppError("Only corporate administrators can add facilities.");
  }
  return db.transaction(async (tx) => {
    const [f] = await tx
      .insert(facilities)
      .values({ ...input, licensedBeds: input.licensedBeds ?? null, organizationId: actor.organizationId, createdBy: actor.userId, updatedBy: actor.userId })
      .returning();
    await audit(tx, ctx, { action: "facility.created", entityType: "facility", entityId: f.id, facilityId: f.id, after: f });
    return f;
  });
}

export async function updateFacility(db: Db, actor: Actor, ctx: AuditContext, facilityId: string, input: FacilityInput & { isActive?: boolean }) {
  assertCan(actor, "facilities.manage", { facilityId });
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
    if (!before) throw new NotFoundError("Facility");
    const values = { ...input, licensedBeds: input.licensedBeds ?? null, updatedBy: actor.userId };
    const [after] = await tx.update(facilities).set(values).where(eq(facilities.id, facilityId)).returning();
    const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
    if (d) await audit(tx, ctx, { action: "facility.updated", entityType: "facility", entityId: facilityId, facilityId, ...d });
    return after;
  });
}

async function facilityOf(db: Db, actor: Actor, facilityId: string) {
  const [f] = await db.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
  if (!f) throw new NotFoundError("Facility");
  return f;
}

export const departmentInput = z.object({
  name: z.string().trim().min(2, "Enter a department name.").max(80),
  code: z.string().trim().max(20).optional().transform((v) => v || null),
  isClinical: z.coerce.boolean().default(false),
});

export async function addDepartment(db: Db, actor: Actor, ctx: AuditContext, facilityId: string, input: z.infer<typeof departmentInput>) {
  assertCan(actor, "facilities.manage", { facilityId });
  await facilityOf(db, actor, facilityId);
  return db.transaction(async (tx) => {
    const [maxOrder] = await tx.select({ m: sql<number>`coalesce(max(${departments.sortOrder}), 0)` }).from(departments).where(eq(departments.facilityId, facilityId));
    const [d] = await tx
      .insert(departments)
      .values({ ...input, facilityId, sortOrder: Number(maxOrder.m) + 1, createdBy: actor.userId, updatedBy: actor.userId })
      .returning();
    await audit(tx, ctx, { action: "department.created", entityType: "department", entityId: d.id, facilityId, after: d });
    return d;
  });
}

export async function setDepartmentActive(db: Db, actor: Actor, ctx: AuditContext, departmentId: string, isActive: boolean) {
  const [d] = await db.select().from(departments).where(eq(departments.id, departmentId));
  if (!d) throw new NotFoundError("Department");
  assertCan(actor, "facilities.manage", { facilityId: d.facilityId });
  await db.transaction(async (tx) => {
    await tx.update(departments).set({ isActive, updatedBy: actor.userId }).where(eq(departments.id, departmentId));
    await audit(tx, ctx, { action: isActive ? "department.activated" : "department.deactivated", entityType: "department", entityId: departmentId, facilityId: d.facilityId });
  });
}

export const unitInput = z.object({ name: z.string().trim().min(1, "Enter a unit name.").max(80) });

export async function addUnit(db: Db, actor: Actor, ctx: AuditContext, departmentId: string, input: z.infer<typeof unitInput>) {
  const [d] = await db.select().from(departments).where(eq(departments.id, departmentId));
  if (!d) throw new NotFoundError("Department");
  assertCan(actor, "facilities.manage", { facilityId: d.facilityId });
  await facilityOf(db, actor, d.facilityId);
  return db.transaction(async (tx) => {
    const [u] = await tx.insert(units).values({ ...input, departmentId, facilityId: d.facilityId, createdBy: actor.userId, updatedBy: actor.userId }).returning();
    await audit(tx, ctx, { action: "unit.created", entityType: "unit", entityId: u.id, facilityId: d.facilityId, after: u });
    return u;
  });
}

export async function setFacilityPositions(db: Db, actor: Actor, ctx: AuditContext, facilityId: string, positionIds: string[]) {
  assertCan(actor, "facilities.manage", { facilityId });
  await facilityOf(db, actor, facilityId);
  const valid = positionIds.length
    ? (await db.select({ id: positions.id }).from(positions).where(and(eq(positions.organizationId, actor.organizationId), inArray(positions.id, positionIds)))).map((p) => p.id)
    : [];
  await db.transaction(async (tx) => {
    const before = (await tx.select().from(facilityPositions).where(eq(facilityPositions.facilityId, facilityId))).map((r) => r.positionId).sort();
    await tx.delete(facilityPositions).where(eq(facilityPositions.facilityId, facilityId));
    if (valid.length) await tx.insert(facilityPositions).values(valid.map((positionId) => ({ facilityId, positionId })));
    await audit(tx, ctx, { action: "facility.positions_updated", entityType: "facility", entityId: facilityId, facilityId, before, after: [...valid].sort() });
  });
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
export const shiftTemplateInput = z.object({
  name: z.string().trim().min(2, "Enter a shift name.").max(40),
  code: z.string().trim().toUpperCase().min(1).max(10).regex(/^[A-Z0-9-]+$/, "Use letters or numbers."),
  startTime: z.string().regex(timeRe, "Use HH:MM."),
  endTime: z.string().regex(timeRe, "Use HH:MM."),
  unpaidBreakMinutes: z.coerce.number().int().min(0).max(240).default(0),
});

export function paidHours(start: string, end: string, breakMinutes: number): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.max(0, (minutes - breakMinutes) / 60);
}

export async function addShiftTemplate(db: Db, actor: Actor, ctx: AuditContext, facilityId: string, input: z.infer<typeof shiftTemplateInput>) {
  assertCan(actor, "facilities.manage", { facilityId });
  await facilityOf(db, actor, facilityId);
  if (input.startTime === input.endTime) throw new AppError("Start and end time can't be the same.");
  return db.transaction(async (tx) => {
    const [maxOrder] = await tx.select({ m: sql<number>`coalesce(max(${shiftTemplates.sortOrder}), 0)` }).from(shiftTemplates).where(eq(shiftTemplates.facilityId, facilityId));
    const [t] = await tx
      .insert(shiftTemplates)
      .values({ ...input, facilityId, sortOrder: Number(maxOrder.m) + 1, createdBy: actor.userId, updatedBy: actor.userId })
      .returning();
    await audit(tx, ctx, { action: "shift_template.created", entityType: "shift_template", entityId: t.id, facilityId, after: t });
    return t;
  });
}

export async function setShiftTemplateActive(db: Db, actor: Actor, ctx: AuditContext, templateId: string, isActive: boolean) {
  const [t] = await db.select().from(shiftTemplates).where(eq(shiftTemplates.id, templateId));
  if (!t) throw new NotFoundError("Shift");
  assertCan(actor, "facilities.manage", { facilityId: t.facilityId });
  await db.transaction(async (tx) => {
    await tx.update(shiftTemplates).set({ isActive, updatedBy: actor.userId }).where(eq(shiftTemplates.id, templateId));
    await audit(tx, ctx, { action: isActive ? "shift_template.activated" : "shift_template.deactivated", entityType: "shift_template", entityId: templateId, facilityId: t.facilityId });
  });
}

export const positionInput = z.object({
  code: z.string().trim().toUpperCase().min(1).max(12).regex(/^[A-Z0-9-]+$/, "Use letters or numbers."),
  name: z.string().trim().min(2).max(80),
  isClinical: z.coerce.boolean().default(false),
});

export async function listPositions(db: Db, actor: Actor) {
  return db.select().from(positions).where(eq(positions.organizationId, actor.organizationId)).orderBy(asc(positions.sortOrder), asc(positions.name));
}

export async function createPosition(db: Db, actor: Actor, ctx: AuditContext, input: z.infer<typeof positionInput>) {
  assertCan(actor, "positions.manage");
  return db.transaction(async (tx) => {
    const [maxOrder] = await tx.select({ m: sql<number>`coalesce(max(${positions.sortOrder}), 0)` }).from(positions).where(eq(positions.organizationId, actor.organizationId));
    const [p] = await tx.insert(positions).values({ ...input, organizationId: actor.organizationId, sortOrder: Number(maxOrder.m) + 1 }).returning();
    await audit(tx, ctx, { action: "position.created", entityType: "position", entityId: p.id, after: p });
    return p;
  });
}

/** Read-only view of the facility's current staffing budget(s). Editing arrives with Phase 2. */
export async function getStaffingBudgets(db: Db, actor: Actor, facilityId: string) {
  assertCan(actor, "budgets.view", { facilityId });
  const templates = await db.select().from(staffingBudgetTemplates).where(and(eq(staffingBudgetTemplates.facilityId, facilityId), eq(staffingBudgetTemplates.isActive, true)));
  const out = [];
  for (const t of templates) {
    const reqs = await db
      .select({ req: staffingBudgetRequirements, positionCode: positions.code, positionName: positions.name, shiftCode: shiftTemplates.code, shiftName: shiftTemplates.name, shiftOrder: shiftTemplates.sortOrder, start: shiftTemplates.startTime, end: shiftTemplates.endTime, brk: shiftTemplates.unpaidBreakMinutes, positionOrder: positions.sortOrder })
      .from(staffingBudgetRequirements)
      .innerJoin(positions, eq(positions.id, staffingBudgetRequirements.positionId))
      .innerJoin(shiftTemplates, eq(shiftTemplates.id, staffingBudgetRequirements.shiftTemplateId))
      .where(eq(staffingBudgetRequirements.templateId, t.id));
    const [dept] = t.departmentId ? await db.select({ name: departments.name }).from(departments).where(eq(departments.id, t.departmentId)) : [];
    const shiftsMap = new Map<string, { code: string; name: string; order: number; rows: Map<string, { code: string; name: string; order: number; days: number[] }> }>();
    let weeklyHours = 0;
    for (const r of reqs) {
      weeklyHours += r.req.requiredCount * paidHours(r.start, r.end, r.brk);
      let s = shiftsMap.get(r.shiftCode);
      if (!s) shiftsMap.set(r.shiftCode, (s = { code: r.shiftCode, name: r.shiftName, order: r.shiftOrder, rows: new Map() }));
      let row = s.rows.get(r.positionCode);
      if (!row) s.rows.set(r.positionCode, (row = { code: r.positionCode, name: r.positionName, order: r.positionOrder, days: [0, 0, 0, 0, 0, 0, 0] }));
      row.days[r.req.dayOfWeek] += r.req.requiredCount;
    }
    out.push({
      template: t,
      departmentName: dept?.name ?? null,
      weeklyHours: Math.round(weeklyHours),
      shifts: [...shiftsMap.values()].sort((a, b) => a.order - b.order).map((s) => ({ ...s, rows: [...s.rows.values()].sort((a, b) => a.order - b.order) })),
    });
  }
  return out;
}
