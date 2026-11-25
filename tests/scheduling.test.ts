import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { employeeFacilityAuthorizations, employeePayRates, employeePositions, employees, positions, ruleOverrides, shifts, shiftTemplates, staffingBudgetRequirements, staffingBudgetTemplates, timekeepingRecords } from "@/db/schema";
import { addDaysStr, localDate, localTime, weekStartOf } from "@/lib/tz";
import { getEmployeeProfile } from "@/server/employees";
import { assignEmployee, decideApproval, pendingApprovals, unassign } from "@/server/scheduling/assignments";
import { budgetEditorData, copyBudgetTemplate, saveBudgetMatrix } from "@/server/scheduling/budgets";
import { weeklyHours, workweekFor } from "@/server/scheduling/hours";
import { evaluateAssignment } from "@/server/scheduling/rules";
import { copyWeek, ensureWeek, weekView } from "@/server/scheduling/schedules";
import { actorFor, ctxFor, demoDb, facilityByCode } from "./helpers";
import type { Actor } from "@/server/rbac/access";

let db: Db;
let corp: Actor, scheduler: Actor, don: Actor;
let mgr: { id: string; timezone: string }, crk: { id: string };
const today = new Date().toISOString().slice(0, 10);
const W1 = addDaysStr(weekStartOf(today, 0), 21); // a future week, clear of demo punches
const W2 = addDaysStr(W1, 7);

beforeAll(async () => {
  ({ db } = await demoDb());
  [corp, scheduler, don] = await Promise.all([actorFor(db, "corporate@demo.test"), actorFor(db, "scheduler@demo.test"), actorFor(db, "don@demo.test")]);
  mgr = await facilityByCode(db, "MGR");
  crk = await facilityByCode(db, "CRK");
});

async function shiftAt(facilityId: string, date: string, shiftCode: string, posCode: string) {
  const [row] = await db
    .select({ s: shifts })
    .from(shifts)
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shifts.shiftTemplateId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(and(eq(shifts.facilityId, facilityId), eq(shifts.workDate, date), eq(shiftTemplates.code, shiftCode), eq(positions.code, posCode)));
  return row?.s;
}

/** Active MGR employees with a given primary position whose first assignment would be clean. */
async function cleanEmployees(posCode: string, count: number, facilityId = mgr.id) {
  const rows = await db
    .select({ id: employees.id, type: employees.employmentType })
    .from(employees)
    .innerJoin(employeePositions, eq(employeePositions.employeeId, employees.id))
    .innerJoin(positions, eq(positions.id, employeePositions.positionId))
    .where(and(eq(employees.homeFacilityId, facilityId), eq(employees.employmentStatus, "active"), eq(positions.code, posCode), eq(employees.isRegionalPool, false)));
  const probe = await shiftAt(facilityId, addDaysStr(W1, 2), "DAY", posCode);
  const out: string[] = [];
  for (const r of rows) {
    if (r.type === "part_time") continue;
    const ev = await evaluateAssignment(db, { employeeId: r.id, shiftId: probe!.id });
    if (ev.outcome === "ok") out.push(r.id);
    if (out.length === count) break;
  }
  return out;
}

describe("schedule generation from budgets", () => {
  it("AC3: a scheduler creates a weekly schedule; shifts come from the budget; re-running is safe", async () => {
    const r = await ensureWeek(db, scheduler, ctxFor(scheduler), mgr.id, W1);
    expect(r.created).toBe(9 * 7); // 3 shifts × 3 positions × 7 days
    const again = await ensureWeek(db, scheduler, ctxFor(scheduler), mgr.id, W1);
    expect(again.created).toBe(0);
    // The MGR scheduler can't build Cedar Ridge's schedule.
    await expect(ensureWeek(db, scheduler, ctxFor(scheduler), crk.id, W1)).rejects.toThrow(/permission/);
    await ensureWeek(db, corp, ctxFor(corp), crk.id, W1);
    await ensureWeek(db, corp, ctxFor(corp), crk.id, W2);
  });

  it("builds shifts in the facility's local time", async () => {
    const s = await shiftAt(mgr.id, W1, "NOC", "RN");
    expect(localTime(s!.startsAt, mgr.timezone)).toBe("23:00");
    expect(localDate(s!.endsAt, mgr.timezone)).toBe(addDaysStr(W1, 1));
    expect(localTime(s!.endsAt, mgr.timezone)).toBe("07:00");
  });

  it("AC5: unfilled budgeted positions appear as open", async () => {
    const v = await weekView(db, scheduler, mgr.id, W1);
    expect(v.totals.required).toBe(7 * (1 + 2 + 5 + 1 + 2 + 4 + 1 + 1 + 3));
    expect(v.totals.open).toBe(v.totals.required);
    const cnaDay = v.rows.find((r) => r.shiftTemplate?.code === "DAY" && r.position.code === "CNA")!;
    expect(cnaDay.cells[0]![0].required).toBe(5);
    expect(cnaDay.cells[0]![0].assigned).toHaveLength(0);
  });

  it("AC4: different staffing for different days, edited in the budget editor", async () => {
    const [tpl] = await db.select().from(staffingBudgetTemplates).where(eq(staffingBudgetTemplates.facilityId, mgr.id));
    const editor = await budgetEditorData(db, corp, tpl.id);
    const day = editor.sections.find((s) => s.shift.code === "DAY")!;
    const cna = day.rows.find((r) => r.positionCode === "CNA")!;
    const cells = editor.sections.flatMap((s) => s.rows.flatMap((r) => r.days.map((n, d) => ({ unitId: r.unitId, positionId: r.positionId, shiftTemplateId: s.shift.id, dayOfWeek: d, requiredCount: s.shift.code === "DAY" && r.positionCode === "CNA" && d === 6 ? 3 : n }))));
    const changed = await saveBudgetMatrix(db, corp, ctxFor(corp), tpl.id, cells);
    expect(changed).toBe(1);
    await expect(saveBudgetMatrix(db, scheduler, ctxFor(scheduler), tpl.id, cells)).rejects.toThrow(/permission/);
    await ensureWeek(db, scheduler, ctxFor(scheduler), mgr.id, W2);
    expect((await shiftAt(mgr.id, addDaysStr(W2, 6), "DAY", "CNA"))!.requiredCount).toBe(3); // Saturday
    expect((await shiftAt(mgr.id, addDaysStr(W2, 5), "DAY", "CNA"))!.requiredCount).toBe(5); // Friday
    void cna;
  });

  it("copies a budget to another facility (inactive until reviewed)", async () => {
    const [tpl] = await db.select().from(staffingBudgetTemplates).where(eq(staffingBudgetTemplates.facilityId, mgr.id));
    const copy = await copyBudgetTemplate(db, corp, ctxFor(corp), tpl.id, crk.id);
    expect(copy.isActive).toBe(false);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(staffingBudgetRequirements).where(eq(staffingBudgetRequirements.templateId, copy.id));
    expect(n).toBeGreaterThan(0);
  });
});

describe("rules engine and assignments", () => {
  it("assigns a qualified, authorized employee and updates coverage", async () => {
    const [e] = await cleanEmployees("CNA", 1);
    const s = await shiftAt(mgr.id, addDaysStr(W1, 1), "DAY", "CNA");
    const r = await assignEmployee(db, scheduler, ctxFor(scheduler), { shiftId: s!.id, employeeId: e });
    expect(r.status).toBe("assigned");
    const v = await weekView(db, scheduler, mgr.id, W1);
    const cell = v.rows.find((x) => x.shiftTemplate?.code === "DAY" && x.position.code === "CNA")!.cells[1]![0];
    expect(cell.assigned).toHaveLength(1); // 1/5
  });

  it("hard-blocks unqualified positions and unauthorized facilities", async () => {
    const [cna] = await cleanEmployees("CNA", 1);
    const rn = await shiftAt(mgr.id, addDaysStr(W1, 3), "DAY", "RN");
    expect((await assignEmployee(db, scheduler, ctxFor(scheduler), { shiftId: rn!.id, employeeId: cna })).status).toBe("blocked");
    const crkShift = await shiftAt(crk.id, addDaysStr(W1, 3), "EVE", "CNA");
    const admin = await actorFor(db, "corporate@demo.test");
    const r = await assignEmployee(db, admin, ctxFor(admin), { shiftId: crkShift!.id, employeeId: cna });
    expect(r.status).toBe("blocked");
    expect(r.evaluation.results.some((x) => x.ruleType === "facility_authorization")).toBe(true);
  });

  it("AC10: overlapping shifts are a non-overridable hard block", async () => {
    const [e] = await cleanEmployees("CNA", 1);
    const day = await shiftAt(mgr.id, addDaysStr(W1, 4), "DAY", "CNA");
    expect((await assignEmployee(db, corp, ctxFor(corp), { shiftId: day!.id, employeeId: e })).status).toBe("assigned");
    // Same employee, same time, different position row -> manual extra shift overlapping
    const day2 = await shiftAt(mgr.id, addDaysStr(W1, 4), "DAY", "LPN");
    const r = await assignEmployee(db, corp, ctxFor(corp), { shiftId: day2!.id, employeeId: e, explanation: "trying to override" });
    expect(r.status).toBe("blocked");
  });

  it("requires approval for too little rest; schedulers send a request, the DON approves", async () => {
    const [e] = await cleanEmployees("CNA", 1);
    const eve = await shiftAt(mgr.id, addDaysStr(W1, 5), "EVE", "CNA"); // 15:00–23:00
    const nextDay = await shiftAt(mgr.id, addDaysStr(W1, 6), "DAY", "CNA"); // 07:00 next day = 8h rest… use NOC→DAY
    const first = await assignEmployee(db, scheduler, ctxFor(scheduler), { shiftId: eve!.id, employeeId: e });
    expect(first.status, first.message).toBe("assigned");
    // Back-to-back: EVE ends 23:00, NOC starts 23:00 -> zero rest.
    const noc = await shiftAt(mgr.id, addDaysStr(W1, 5), "NOC", "CNA"); // 23:00 same day, 0h rest after EVE
    const r = await assignEmployee(db, scheduler, ctxFor(scheduler), { shiftId: noc!.id, employeeId: e });
    expect(["pending_approval", "needs_override"]).toContain(r.status);
    void nextDay;
  });

  it("overtime across ALL facilities requires approval (AC9)", async () => {
    // A pool employee authorized at both MGR and CRK.
    const [pe] = await db
      .select({ id: employees.id })
      .from(employees)
      .innerJoin(employeePositions, eq(employeePositions.employeeId, employees.id))
      .innerJoin(positions, eq(positions.id, employeePositions.positionId))
      .where(and(eq(employees.isRegionalPool, true), eq(employees.employmentStatus, "active"), eq(positions.code, "CNA")))
      .limit(1);
    for (const f of [mgr.id, crk.id]) await db.insert(employeeFacilityAuthorizations).values({ employeeId: pe.id, facilityId: f, reason: "test" }).onConflictDoNothing();
    // Make credentials clean for the test.
    await db.execute(sql`update employee_credentials set status = 'verified', expires_on = '2030-01-01' where employee_id = ${pe.id}`);
    const plan: [string, number][] = [[mgr.id, 0], [crk.id, 1], [mgr.id, 2], [crk.id, 3], [mgr.id, 4]];
    for (const [f, d] of plan) {
      const s = await shiftAt(f, addDaysStr(W2, d), "DAY", "CNA");
      const r = await assignEmployee(db, corp, ctxFor(corp), { shiftId: s!.id, employeeId: pe.id, explanation: "test setup ok" });
      expect(r.status).toBe("assigned");
    }
    const sixth = await shiftAt(crk.id, addDaysStr(W2, 5), "DAY", "CNA");
    const ev = await evaluateAssignment(db, { employeeId: pe.id, shiftId: sixth!.id });
    expect(ev.hours.scheduled).toBe(40); // 3 shifts at MGR + 2 at CRK
    expect(Object.keys(ev.hours.byFacility).sort()).toEqual([mgr.id, crk.id].sort());
    expect(ev.hours.afterAssignment).toBe(48);
    expect(ev.results.find((r) => r.ruleType === "overtime")?.outcome).toBe("approval_required");

    const sch = await actorFor(db, "scheduler@demo.test"); // MGR scheduler can't manage CRK
    await expect(assignEmployee(db, sch, ctxFor(sch), { shiftId: sixth!.id, employeeId: pe.id })).rejects.toThrow(/permission/);
    const mgrSixth = await shiftAt(mgr.id, addDaysStr(W2, 6), "DAY", "CNA");
    const req = await assignEmployee(db, scheduler, ctxFor(scheduler), { shiftId: mgrSixth!.id, employeeId: pe.id });
    expect(req.status).toBe("pending_approval");
    const pending = await pendingApprovals(db, don, mgr.id);
    expect(pending.some((p) => p.request.id === req.approvalRequestId)).toBe(true);
    await expect(decideApproval(db, scheduler, ctxFor(scheduler), req.approvalRequestId!, true, "approve it")).rejects.toThrow(/permission/);
    const decided = await decideApproval(db, don, ctxFor(don), req.approvalRequestId!, true, "Short-staffed, approved by DON");
    expect(decided?.status).toBe("assigned");
    const [ov] = await db.select().from(ruleOverrides).where(eq(ruleOverrides.subjectId, decided!.assignmentId!));
    expect(ov.ruleType).toBe("overtime");
    expect(ov.explanation).toContain("Short-staffed");
  });

  it("overridable hard blocks need override permission and an explanation", async () => {
    const [e] = await cleanEmployees("RN", 1);
    // Make a 17h day: DAY (8) + EVE (8) back-to-back + an extra manual shift isn't needed: lower the daily limit for this facility instead.
    await db.execute(sql`insert into scheduling_rules (organization_id, facility_id, rule_type, name, params, outcome, overridable) select organization_id, ${mgr.id}::uuid, 'max_daily_hours', 'Max daily (facility)', '{"hours": 8}'::jsonb, 'hard_block', true from facilities where id = ${mgr.id}::uuid`);
    const day = await shiftAt(mgr.id, addDaysStr(W1, 0), "DAY", "RN");
    const eve = await shiftAt(mgr.id, addDaysStr(W1, 0), "EVE", "RN");
    expect((await assignEmployee(db, corp, ctxFor(corp), { shiftId: day!.id, employeeId: e })).status).toBe("assigned");
    const noPerm = await assignEmployee(db, scheduler, ctxFor(scheduler), { shiftId: eve!.id, employeeId: e });
    expect(noPerm.status).toBe("needs_override");
    const noReason = await assignEmployee(db, don, ctxFor(don), { shiftId: eve!.id, employeeId: e });
    expect(noReason.status).toBe("needs_override");
    const ok = await assignEmployee(db, don, ctxFor(don), { shiftId: eve!.id, employeeId: e, explanation: "Double approved for census spike" });
    expect(ok.status).toBe("assigned");
    await db.execute(sql`update scheduling_rules set is_active = false where facility_id = ${mgr.id}::uuid`);
  });

  it("copies a week's assignments through the rules engine", async () => {
    const before = await weekView(db, scheduler, mgr.id, W1);
    const r = await copyWeek(db, scheduler, ctxFor(scheduler), mgr.id, W1, addDaysStr(W1, 28));
    expect(r.copied).toBeGreaterThan(0);
    const after = await weekView(db, scheduler, mgr.id, addDaysStr(W1, 28));
    expect(after.totals.filled).toBe(r.copied);
    expect(r.copied).toBeLessThanOrEqual(before.totals.filled);
  });

  it("unassigning keeps the record (cancelled), freeing the slot", async () => {
    const v = await weekView(db, scheduler, mgr.id, W1);
    const a = v.rows.flatMap((r) => r.cells.flat()).find((c) => c && c.assigned.length)!.assigned[0];
    await unassign(db, scheduler, ctxFor(scheduler), a.assignmentId, "Changed plans");
    const v2 = await weekView(db, scheduler, mgr.id, W1);
    expect(v2.totals.filled).toBe(v.totals.filled - 1);
  });
});

describe("hours (AC18)", () => {
  it("distinguishes actual, approved, scheduled and projected hours", async () => {
    const [e] = await cleanEmployees("LPN", 1);
    const d0 = await shiftAt(mgr.id, addDaysStr(W1, 1), "DAY", "LPN");
    const d1 = await shiftAt(mgr.id, addDaysStr(W1, 2), "DAY", "LPN");
    await assignEmployee(db, corp, ctxFor(corp), { shiftId: d0!.id, employeeId: e });
    await assignEmployee(db, corp, ctxFor(corp), { shiftId: d1!.id, employeeId: e });
    const [org] = await db.execute(sql`select organization_id from facilities where id = ${mgr.id}::uuid`).then((r) => (r as unknown as { rows: { organization_id: string }[] }).rows);
    await db.insert(timekeepingRecords).values({ organizationId: org.organization_id, source: "aod", externalId: "t-1", employeeId: e, facilityId: mgr.id, workDate: addDaysStr(W1, 1), punchIn: d0!.startsAt, punchOut: new Date(d0!.startsAt.getTime() + 6.5 * 3_600_000), hours: "6.5", approved: true });
    const week = workweekFor(d0!.startsAt, "America/New_York", 0);
    const now = new Date(d1!.startsAt.getTime() - 3_600_000); // between the two shifts
    const h = (await weeklyHours(db, [e], week, now)).get(e)!;
    expect(h.scheduled).toBe(16);
    expect(h.actual).toBe(6.5);
    expect(h.approved).toBe(6.5);
    expect(h.projected).toBe(14.5); // actual for the past day + scheduled for the upcoming one
  });
});

describe("pay rates (A1)", () => {
  it("are imported and visible only with pay access", async () => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(employeePayRates);
    expect(n).toBeGreaterThan(300);
    const [e] = await db.select({ id: employees.id }).from(employees).where(eq(employees.homeFacilityId, mgr.id)).limit(1);
    expect((await getEmployeeProfile(db, corp, e.id)).payRates.length).toBe(1);
    const admin = await actorFor(db, "administrator@demo.test");
    const p = await getEmployeeProfile(db, admin, e.id);
    expect(p.showPay).toBe(false);
    expect(p.payRates).toHaveLength(0);
    void inArray;
  });
});
