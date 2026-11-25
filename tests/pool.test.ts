import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { employeeFacilityAuthorizations, employees, notifications, positions, shiftAssignments, shifts, users } from "@/db/schema";
import { addDaysStr, weekStartOf, zonedToUtc } from "@/lib/tz";
import { authorizeFacility } from "@/server/employees";
import { addToPool, poolAddCandidates, poolCandidates, poolDashboard, placePoolEmployee, poolScope } from "@/server/pool";
import type { Actor } from "@/server/rbac/access";
import { assignEmployee } from "@/server/scheduling/assignments";
import { evaluateAssignment } from "@/server/scheduling/rules";
import { actorFor, ctxFor, demoDb, facilityByCode } from "./helpers";

let db: Db;
let orgId: string;
let corp: Actor, poolMgr: Actor, regional: Actor, scheduler: Actor;
let mgr: { id: string; timezone: string; code: string }, crk: { id: string; timezone: string; code: string }, other: { id: string; timezone: string; code: string };
const today = new Date().toISOString().slice(0, 10);

async function newShift(f: { id: string; timezone: string }, date: string, start = "07:00", posCode = "CNA", required = 1) {
  const [p] = await db.select().from(positions).where(and(eq(positions.organizationId, orgId), eq(positions.code, posCode)));
  const startsAt = zonedToUtc(date, start, f.timezone);
  const [s] = await db.insert(shifts).values({ facilityId: f.id, positionId: p.id, workDate: date, startsAt, endsAt: new Date(startsAt.getTime() + 8 * 3_600_000), paidHours: "8", requiredCount: required, source: "manual" }).returning();
  return s;
}

/** A pool CNA whose assignment at both MGR and CRK would be clean (credentials current etc.). */
let cleanPoolCna: typeof employees.$inferSelect | undefined;
async function poolCna() {
  if (cleanPoolCna) return cleanPoolCna;
  const rows = await db.select().from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isRegionalPool, true), eq(employees.employmentStatus, "active")));
  const probes = [await newShift(mgr, addDaysStr(today, 40), "07:00", "CNA", 99), await newShift(crk, addDaysStr(today, 41), "07:00", "CNA", 99)];
  for (const e of rows) {
    const evs = await Promise.all(probes.map((p) => evaluateAssignment(db, { employeeId: e.id, shiftId: p.id })));
    if (evs.every((ev) => ev.outcome === "ok")) {
      cleanPoolCna = e;
      break;
    }
  }
  if (!cleanPoolCna) throw new Error("no clean pool CNA");
  return cleanPoolCna;
}

beforeAll(async () => {
  ({ db, orgId } = await demoDb());
  [corp, poolMgr, regional, scheduler] = await Promise.all(["corporate", "pool", "regional", "scheduler"].map((n) => actorFor(db, `${n}@demo.test`)));
  mgr = await facilityByCode(db, "MGR");
  crk = await facilityByCode(db, "CRK");
  other = (await db.select().from((await import("@/db/schema")).facilities)).find((f) => !["MGR", "CRK", "OKH", "WLW"].includes(f.code))!;
  // Make sure the pool CNA is authorized at both MGR and CRK.
  const pool = await db.select().from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isRegionalPool, true), eq(employees.employmentStatus, "active")));
  for (const e of pool) for (const f of [mgr, crk]) await authorizeFacility(db, corp, ctxFor(corp), e.id, f.id, "Test setup").catch(() => null);
});

describe("regional pool dashboard", () => {
  it("scope: pool manager and corporate see every facility; a regional director only their own", () => {
    expect(poolScope(poolMgr)).toBe("all");
    expect(poolScope(corp)).toBe("all");
    const r = poolScope(regional);
    expect(Array.isArray(r) && r.length).toBe(4);
    expect(poolScope(scheduler)).toEqual([mgr.id]);
  });

  it("shows each pool member once, with hours consolidated across facilities", async () => {
    const e = await poolCna();
    // Two shifts tomorrow at two facilities (morning at CRK, night at MGR: 9 hours' rest).
    const d1 = addDaysStr(today, 1);
    const s1 = await newShift(mgr, d1, "23:00");
    const s2 = await newShift(crk, d1, "06:00");
    expect((await assignEmployee(db, corp, ctxFor(corp), { shiftId: s2.id, employeeId: e.id })).status).toBe("assigned");
    expect((await assignEmployee(db, corp, ctxFor(corp), { shiftId: s1.id, employeeId: e.id, explanation: "Test: approved rest exception" })).status).toBe("assigned");
    const offset = weekStartOf(d1, 0) === weekStartOf(today, 0) ? 0 : 1;
    const d = await poolDashboard(db, poolMgr, { weekOffset: offset });
    const ids = d.members.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const me = d.members.find((m) => m.id === e.id)!;
    expect(me.facilities.map((f) => f.code)).toEqual(expect.arrayContaining(["MGR", "CRK"]));
    const codes = me.hours.byFacility.map((b) => b.code).sort();
    expect(localWeekContains(d.week.startDate, d1)).toBe(true);
    expect(codes).toEqual(expect.arrayContaining(["CRK", "MGR"]));
    expect(me.hours.scheduled).toBeGreaterThanOrEqual(16);
    expect(me.remaining).toBe(Math.max(0, Math.round((me.limit - me.hours.projected) * 10) / 10));
    expect(d.totals.members).toBeGreaterThan(5);
  });

  it("lists unfilled shifts where pool staff could help, with how many are eligible", async () => {
    const s = await newShift(mgr, addDaysStr(today, 2), "15:00", "CNA", 2);
    const d = await poolDashboard(db, poolMgr);
    const need = d.needs.find((n) => n.id === s.id)!;
    expect(need.open).toBe(2);
    expect(need.eligiblePool).toBeGreaterThan(0);
    expect(need.canPlace).toBe(true);
    expect(d.byFacility.find((f) => f.code === "MGR")!.openSlots).toBeGreaterThanOrEqual(2);
    // The regional director sees only their four facilities.
    const far = await newShift(other, addDaysStr(today, 2), "15:00");
    const rd = await poolDashboard(db, regional);
    expect(rd.needs.some((n) => n.id === far.id)).toBe(false);
    expect((await poolDashboard(db, corp)).needs.some((n) => n.id === far.id)).toBe(true);
    await expect(poolCandidates(db, regional, far.id)).rejects.toThrow(/permission/);
  });
});

describe("placing pool staff", () => {
  it("ranks candidates by the rules engine and lets the pool manager place them; employee and schedulers are told", async () => {
    const s = await newShift(crk, addDaysStr(today, 4), "07:00");
    const { candidates } = await poolCandidates(db, poolMgr, s.id);
    expect(candidates.length).toBeGreaterThan(0);
    const rank = { ok: 0, warning: 1, approval_required: 2, hard_block: 3 } as const;
    for (let i = 1; i < candidates.length; i++) expect(rank[candidates[i].outcome]).toBeGreaterThanOrEqual(rank[candidates[i - 1].outcome]);
    const pick = candidates.find((c) => c.outcome === "ok" || c.outcome === "warning")!;
    const r = await placePoolEmployee(db, poolMgr, ctxFor(poolMgr), { shiftId: s.id, employeeId: pick.employeeId });
    expect(r.status).toBe("assigned");
    const [a] = await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, s.id), eq(shiftAssignments.status, "assigned")));
    expect(a.employeeId).toBe(pick.employeeId);
    const crkSchedulers = await db.select().from(notifications).where(eq(notifications.category, "pool_placement"));
    expect(crkSchedulers.length).toBeGreaterThan(0);
    const [linked] = await db.select().from(users).where(eq(users.employeeId, pick.employeeId));
    if (linked) expect((await db.select().from(notifications).where(and(eq(notifications.userId, linked.id), eq(notifications.category, "pool_assignment")))).length).toBe(1);
  });

  it("the pool manager can't place non-pool employees, and the overlap rule still holds", async () => {
    const s = await newShift(mgr, addDaysStr(today, 5), "07:00");
    const [nonPool] = await db.select().from(employees).where(and(eq(employees.homeFacilityId, mgr.id), eq(employees.isRegionalPool, false), eq(employees.employmentStatus, "active")));
    await expect(placePoolEmployee(db, poolMgr, ctxFor(poolMgr), { shiftId: s.id, employeeId: nonPool.id })).rejects.toThrow(/pool employees/);
    await expect(assignEmployee(db, poolMgr, ctxFor(poolMgr), { shiftId: s.id, employeeId: nonPool.id })).rejects.toThrow(/permission/);

    const e = await poolCna();
    const first = await newShift(mgr, addDaysStr(today, 6), "07:00");
    const clash = await newShift(crk, addDaysStr(today, 6), "09:00");
    expect((await placePoolEmployee(db, poolMgr, ctxFor(poolMgr), { shiftId: first.id, employeeId: e.id })).status).toBe("assigned");
    const { candidates } = await poolCandidates(db, poolMgr, clash.id);
    const c = candidates.find((x) => x.employeeId === e.id)!;
    expect(c.blocked).toBe(true);
    expect(c.messages.some((m) => /Overlaps/.test(m.message))).toBe(true);
    const r = await placePoolEmployee(db, poolMgr, ctxFor(poolMgr), { shiftId: clash.id, employeeId: e.id });
    expect(r.status).toBe("blocked");
  });

  it("adds an employee to the pool with facility authorizations in one step (pool manager can authorize pool staff)", async () => {
    const list = await poolAddCandidates(db, poolMgr);
    expect(list.length).toBeGreaterThan(0);
    const target = list[0];
    await expect(addToPool(db, scheduler, ctxFor(scheduler), { employeeId: target.id, facilityIds: [crk.id], reason: "Float" })).rejects.toThrow(/permission/);
    await addToPool(db, poolMgr, ctxFor(poolMgr), { employeeId: target.id, facilityIds: [mgr.id, crk.id], reason: "Cross-trained float CNA" });
    const [e] = await db.select().from(employees).where(eq(employees.id, target.id));
    expect(e.isRegionalPool).toBe(true);
    const auths = await db.select().from(employeeFacilityAuthorizations).where(and(eq(employeeFacilityAuthorizations.employeeId, target.id), isNull(employeeFacilityAuthorizations.revokedAt)));
    expect(auths.map((a) => a.facilityId).filter((f) => f !== e.homeFacilityId).length).toBeGreaterThanOrEqual(1);
    // The pool manager (pool-scoped) can now authorize this pool employee elsewhere.
    await authorizeFacility(db, poolMgr, ctxFor(poolMgr), target.id, other.id, "Approved by regional director");
    expect((await db.select().from(employeeFacilityAuthorizations).where(and(eq(employeeFacilityAuthorizations.employeeId, target.id), eq(employeeFacilityAuthorizations.facilityId, other.id)))).length).toBe(1);
    expect((await poolDashboard(db, poolMgr)).members.some((m) => m.id === target.id)).toBe(true);
  });
});

function localWeekContains(weekStart: string, date: string) {
  return date >= weekStart && date <= addDaysStr(weekStart, 6);
}
