import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { facilities, overtimeRules, schedulingRules } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { can, hasOrgWide, type Actor } from "../rbac/access";

/** Rules that protect data integrity; their outcome can't be weakened. */
export const LOCKED_RULES = new Set(["overlapping_shifts"]);

export const PARAM_FIELDS: Record<string, { key: string; label: string; unit: string }[]> = {
  min_rest_hours: [{ key: "hours", label: "Minimum rest", unit: "hours" }],
  max_daily_hours: [{ key: "hours", label: "Maximum per day", unit: "hours" }],
  max_weekly_hours: [{ key: "hours", label: "Maximum per week", unit: "hours" }],
  max_consecutive_days: [{ key: "days", label: "Maximum in a row", unit: "days" }],
  employment_classification: [
    { key: "maxWeeklyHours.part_time", label: "Part-time weekly guideline", unit: "hours" },
    { key: "maxWeeklyHours.prn", label: "PRN weekly guideline", unit: "hours" },
  ],
};

function canManageRules(actor: Actor, facilityId?: string | null) {
  return facilityId ? can(actor, "rules.manage", { facilityId }) : hasOrgWide(actor, "rules.manage");
}

export async function rulesForScope(db: Db, actor: Actor, facilityId?: string) {
  if (!can(actor, "rules.view")) throw new AppError("You don't have access to rules.", "FORBIDDEN", 403);
  const org = await db.select().from(schedulingRules).where(and(eq(schedulingRules.organizationId, actor.organizationId), isNull(schedulingRules.facilityId))).orderBy(asc(schedulingRules.priority));
  const fac = facilityId ? await db.select().from(schedulingRules).where(and(eq(schedulingRules.organizationId, actor.organizationId), eq(schedulingRules.facilityId, facilityId), eq(schedulingRules.isActive, true))) : [];
  const [otOrg] = await db.select().from(overtimeRules).where(and(eq(overtimeRules.organizationId, actor.organizationId), isNull(overtimeRules.facilityId)));
  return {
    rules: org.map((r) => ({ org: r, facility: fac.find((f) => f.ruleType === r.ruleType) ?? null, locked: LOCKED_RULES.has(r.ruleType) })),
    overtime: otOrg ?? null,
    confirmed: org.every((r) => r.confirmedAt) && !!otOrg?.confirmedAt,
    canManageOrg: canManageRules(actor),
    canManageFacility: facilityId ? canManageRules(actor, facilityId) : false,
  };
}

function setPath(obj: Record<string, unknown>, path: string, v: number | undefined) {
  const [a, b] = path.split(".");
  if (!b) {
    if (v === undefined) delete obj[a];
    else obj[a] = v;
    return;
  }
  const inner = { ...((obj[a] as Record<string, unknown>) ?? {}) };
  if (v === undefined) delete inner[b];
  else inner[b] = v;
  obj[a] = inner;
}

export async function updateRule(
  db: Db,
  actor: Actor,
  ctx: AuditContext,
  ruleId: string,
  input: { outcome: "warning" | "approval_required" | "hard_block"; overridable: boolean; isActive: boolean; params: Record<string, string> },
) {
  const [r] = await db.select().from(schedulingRules).where(and(eq(schedulingRules.id, ruleId), eq(schedulingRules.organizationId, actor.organizationId)));
  if (!r) throw new NotFoundError("Rule");
  if (!canManageRules(actor, r.facilityId)) throw new AppError("You don't have permission to change this rule.", "FORBIDDEN", 403);
  if (LOCKED_RULES.has(r.ruleType) && (input.outcome !== "hard_block" || input.overridable || !input.isActive)) throw new AppError("Overlapping shifts are always blocked. The database enforces this too.");
  const params = { ...(r.params as Record<string, unknown>) };
  for (const f of PARAM_FIELDS[r.ruleType] ?? []) {
    const raw = input.params[f.key];
    if (raw === undefined) continue;
    if (raw === "") setPath(params, f.key, undefined);
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > 200) throw new AppError(`${f.label} must be a positive number.`);
      setPath(params, f.key, n);
    }
  }
  await db.transaction(async (tx) => {
    // Any change resets confirmation for the changed rule.
    await tx.update(schedulingRules).set({ outcome: input.outcome, overridable: input.overridable, isActive: input.isActive, params, confirmedAt: null, confirmedBy: null, updatedBy: actor.userId }).where(eq(schedulingRules.id, ruleId));
    await audit(tx, ctx, { action: "rule.updated", entityType: "scheduling_rule", entityId: ruleId, facilityId: r.facilityId, before: { outcome: r.outcome, overridable: r.overridable, isActive: r.isActive, params: r.params }, after: { outcome: input.outcome, overridable: input.overridable, isActive: input.isActive, params } });
  });
}

export async function customizeForFacility(db: Db, actor: Actor, ctx: AuditContext, orgRuleId: string, facilityId: string) {
  if (!canManageRules(actor, facilityId)) throw new AppError("You don't have permission to customize rules for this facility.", "FORBIDDEN", 403);
  const [r] = await db.select().from(schedulingRules).where(and(eq(schedulingRules.id, orgRuleId), eq(schedulingRules.organizationId, actor.organizationId), isNull(schedulingRules.facilityId)));
  const [f] = await db.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
  if (!r || !f) throw new NotFoundError("Rule");
  if (LOCKED_RULES.has(r.ruleType)) throw new AppError("This rule applies everywhere and can't be customized.");
  const { id: _id, createdAt: _c, updatedAt: _u, confirmedAt: _ca, confirmedBy: _cb, ...rest } = r;
  const [copy] = await db.insert(schedulingRules).values({ ...rest, facilityId, name: `${r.name} (${f.code})`, createdBy: actor.userId }).returning();
  await audit(db, ctx, { action: "rule.customized_for_facility", entityType: "scheduling_rule", entityId: copy.id, facilityId });
  return copy;
}

export async function removeFacilityRule(db: Db, actor: Actor, ctx: AuditContext, ruleId: string) {
  const [r] = await db.select().from(schedulingRules).where(and(eq(schedulingRules.id, ruleId), eq(schedulingRules.organizationId, actor.organizationId)));
  if (!r?.facilityId) throw new NotFoundError("Facility rule");
  if (!canManageRules(actor, r.facilityId)) throw new AppError("You don't have permission.", "FORBIDDEN", 403);
  await db.update(schedulingRules).set({ isActive: false, updatedBy: actor.userId }).where(eq(schedulingRules.id, ruleId));
  await audit(db, ctx, { action: "rule.facility_override_removed", entityType: "scheduling_rule", entityId: ruleId, facilityId: r.facilityId });
}

export async function updateOvertimeRule(db: Db, actor: Actor, ctx: AuditContext, input: { weeklyThresholdHours: string; warningAtHours: string; workweekStartDay: number; outcome: "warning" | "approval_required" | "hard_block"; overridable: boolean }) {
  if (!canManageRules(actor)) throw new AppError("Only corporate administrators can change overtime rules.", "FORBIDDEN", 403);
  const [ot] = await db.select().from(overtimeRules).where(and(eq(overtimeRules.organizationId, actor.organizationId), isNull(overtimeRules.facilityId)));
  if (!ot) throw new NotFoundError("Overtime rule");
  const w = Number(input.weeklyThresholdHours);
  const warn = input.warningAtHours === "" ? null : Number(input.warningAtHours);
  if (!Number.isFinite(w) || w <= 0 || w > 168) throw new AppError("Weekly threshold must be between 1 and 168 hours.");
  if (warn !== null && (!Number.isFinite(warn) || warn <= 0 || warn > w)) throw new AppError("The early warning must be lower than the threshold.");
  if (!(input.workweekStartDay >= 0 && input.workweekStartDay <= 6)) throw new AppError("Choose a workweek start day.");
  const values = { weeklyThresholdHours: String(w), warningAtHours: warn === null ? null : String(warn), workweekStartDay: input.workweekStartDay, outcome: input.outcome, overridable: input.overridable, confirmedAt: null, confirmedBy: null, updatedBy: actor.userId };
  await db.transaction(async (tx) => {
    await tx.update(overtimeRules).set(values).where(eq(overtimeRules.id, ot.id));
    await audit(tx, ctx, { action: "overtime_rule.updated", entityType: "overtime_rule", entityId: ot.id, before: { weeklyThresholdHours: ot.weeklyThresholdHours, warningAtHours: ot.warningAtHours, workweekStartDay: ot.workweekStartDay, outcome: ot.outcome }, after: values });
  });
}

/** Records that a corporate administrator reviewed the rules against law and contracts (decision A2). */
export async function confirmRules(db: Db, actor: Actor, ctx: AuditContext, statement: string) {
  if (!canManageRules(actor)) throw new AppError("Only corporate administrators can confirm rules.", "FORBIDDEN", 403);
  if (statement.trim().length < 10) throw new AppError("Please describe what the rules were checked against (e.g. state regulations, union contract).");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(schedulingRules).set({ confirmedAt: now, confirmedBy: actor.userId }).where(eq(schedulingRules.organizationId, actor.organizationId));
    await tx.update(overtimeRules).set({ confirmedAt: now, confirmedBy: actor.userId }).where(eq(overtimeRules.organizationId, actor.organizationId));
    await audit(tx, ctx, { action: "rules.confirmed", entityType: "scheduling_rule", reason: statement });
  });
}
