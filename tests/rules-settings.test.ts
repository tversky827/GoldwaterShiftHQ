import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { employeePositions, schedulingRules, shifts, shiftTemplates } from "@/db/schema";
import { addDaysStr, dayOfWeek, weekStartOf } from "@/lib/tz";
import { saveMyAvailability } from "@/server/me";
import { evaluateAssignment, effectiveRules } from "@/server/scheduling/rules";
import { confirmRules, customizeForFacility, updateRule } from "@/server/scheduling/rule-settings";
import { ensureWeek } from "@/server/scheduling/schedules";
import { actorFor, ctxFor, demoDb, facilityByCode } from "./helpers";

let db: Db;
let orgId: string;
beforeAll(async () => {
  ({ db, orgId } = await demoDb());
});

describe("rule settings (A2)", () => {
  it("starts unconfirmed; confirming needs a statement; any edit resets confirmation", async () => {
    const corp = await actorFor(db, "corporate@demo.test");
    const mgr = await facilityByCode(db, "MGR");
    expect((await effectiveRules(db, orgId, mgr.id)).confirmed).toBe(false);
    await expect(confirmRules(db, corp, ctxFor(corp), "ok")).rejects.toThrow(/describe/);
    await confirmRules(db, corp, ctxFor(corp), "Checked against OH/IN/KY rules and company policy");
    expect((await effectiveRules(db, orgId, mgr.id)).confirmed).toBe(true);
    const [rest] = await db.select().from(schedulingRules).where(and(eq(schedulingRules.organizationId, orgId), eq(schedulingRules.ruleType, "min_rest_hours")));
    await updateRule(db, corp, ctxFor(corp), rest.id, { outcome: "approval_required", overridable: true, isActive: true, params: { hours: "10" } });
    const [after] = await db.select().from(schedulingRules).where(eq(schedulingRules.id, rest.id));
    expect((after.params as { hours: number }).hours).toBe(10);
    expect((await effectiveRules(db, orgId, mgr.id)).confirmed).toBe(false);
  });

  it("can't weaken the overlap rule; only rules managers can edit; facility rules override org rules", async () => {
    const corp = await actorFor(db, "corporate@demo.test");
    const admin = await actorFor(db, "administrator@demo.test");
    const [ov] = await db.select().from(schedulingRules).where(eq(schedulingRules.ruleType, "overlapping_shifts"));
    await expect(updateRule(db, corp, ctxFor(corp), ov.id, { outcome: "warning", overridable: false, isActive: true, params: {} })).rejects.toThrow(/always blocked/);
    const [cons] = await db.select().from(schedulingRules).where(eq(schedulingRules.ruleType, "max_consecutive_days"));
    await expect(updateRule(db, admin, ctxFor(admin), cons.id, { outcome: "hard_block", overridable: false, isActive: true, params: {} })).rejects.toThrow(/permission/);
    const mgr = await facilityByCode(db, "MGR");
    const copy = await customizeForFacility(db, corp, ctxFor(corp), cons.id, mgr.id);
    await updateRule(db, corp, ctxFor(corp), copy.id, { outcome: "hard_block", overridable: false, isActive: true, params: { days: "5" } });
    const eff = await effectiveRules(db, orgId, mgr.id);
    expect(eff.byType.get("max_consecutive_days")?.id).toBe(copy.id);
    const crk = await facilityByCode(db, "CRK");
    expect((await effectiveRules(db, orgId, crk.id)).byType.get("max_consecutive_days")?.id).toBe(cons.id);
  });
});

describe("employee availability", () => {
  it("marking a day unavailable produces an availability warning for that day's shifts", async () => {
    const emp = await actorFor(db, "employee@demo.test");
    const corp = await actorFor(db, "corporate@demo.test");
    const mgr = await facilityByCode(db, "MGR");
    const week = addDaysStr(weekStartOf(new Date().toISOString().slice(0, 10), 0), 35);
    await ensureWeek(db, corp, ctxFor(corp), mgr.id, week);
    const date = addDaysStr(week, 3);
    await saveMyAvailability(db, emp, ctxFor(emp), { unavailableDays: [dayOfWeek(date)], maxWeeklyHours: 32, preferredShiftCodes: ["DAY"], preferredFacilityIds: [] });
    const [pos] = await db.select({ positionId: employeePositions.positionId }).from(employeePositions).where(and(eq(employeePositions.employeeId, emp.employeeId!), eq(employeePositions.isPrimary, true)));
    const [s] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .innerJoin(shiftTemplates, eq(shiftTemplates.id, shifts.shiftTemplateId))
      .where(and(eq(shifts.facilityId, mgr.id), eq(shifts.workDate, date), eq(shifts.positionId, pos.positionId), eq(shiftTemplates.code, "DAY")));
    const ev = await evaluateAssignment(db, { employeeId: emp.employeeId!, shiftId: s.id });
    expect(ev.results.find((r) => r.ruleType === "availability")?.outcome).toBe("warning");
    await expect(saveMyAvailability(db, emp, ctxFor(emp), { unavailableDays: [], maxWeeklyHours: 200, preferredShiftCodes: [], preferredFacilityIds: [] })).rejects.toThrow(/between/);
  });
});
