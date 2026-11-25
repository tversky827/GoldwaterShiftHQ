/**
 * EXAMPLE default rules. These are starting points, not legal advice. They
 * stay "unconfirmed" (shown in the UI) until a Corporate Admin reviews them
 * against state law and contracts and clicks Confirm (decision A2).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { overtimeRules, schedulingRules } from "@/db/schema";

type R = typeof schedulingRules.$inferInsert;

export const DEFAULT_RULES: Omit<R, "organizationId">[] = [
  { ruleType: "overlapping_shifts", name: "No overlapping shifts", outcome: "hard_block", overridable: false, params: {}, priority: 10 },
  { ruleType: "facility_authorization", name: "Authorized for facility", outcome: "hard_block", overridable: false, params: {}, priority: 20 },
  { ruleType: "position_qualification", name: "Qualified for position", outcome: "hard_block", overridable: false, params: {}, priority: 30 },
  { ruleType: "credential_required", name: "Required credentials current", outcome: "hard_block", overridable: false, params: {}, priority: 40 },
  { ruleType: "min_rest_hours", name: "Minimum rest between shifts", outcome: "approval_required", overridable: true, params: { hours: 8 }, priority: 50 },
  { ruleType: "max_daily_hours", name: "Maximum hours per day", outcome: "hard_block", overridable: true, overridePermission: "rules.override", params: { hours: 16 }, priority: 60 },
  { ruleType: "max_weekly_hours", name: "Maximum hours per week", outcome: "hard_block", overridable: true, overridePermission: "rules.override", params: { hours: 60 }, priority: 70 },
  { ruleType: "max_consecutive_days", name: "Maximum consecutive days", outcome: "warning", overridable: true, params: { days: 6 }, priority: 80 },
  { ruleType: "employment_classification", name: "Hours guideline by employment type", outcome: "warning", overridable: true, params: { maxWeeklyHours: { part_time: 32 } }, priority: 90 },
  { ruleType: "availability", name: "Respect employee availability", outcome: "warning", overridable: true, params: {}, priority: 100 },
];

export async function seedDefaultRules(db: Db, organizationId: string) {
  for (const r of DEFAULT_RULES) {
    const [existing] = await db
      .select({ id: schedulingRules.id })
      .from(schedulingRules)
      .where(and(eq(schedulingRules.organizationId, organizationId), eq(schedulingRules.ruleType, r.ruleType), isNull(schedulingRules.facilityId)));
    if (!existing) await db.insert(schedulingRules).values({ ...r, organizationId });
  }
  const [ot] = await db.select({ id: overtimeRules.id }).from(overtimeRules).where(and(eq(overtimeRules.organizationId, organizationId), isNull(overtimeRules.facilityId)));
  if (!ot) {
    await db.insert(overtimeRules).values({
      organizationId,
      name: "Weekly overtime",
      weeklyThresholdHours: "40",
      warningAtHours: "36",
      workweekStartDay: 0,
      outcome: "approval_required",
      overridable: true,
    });
  }
}
