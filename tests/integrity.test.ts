import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLogs, employees, shiftAssignments } from "@/db/schema";
import { demoDb, facilityByCode, makeShift } from "./helpers";

let db: Db;
let orgId: string;
let empA: string;
let empB: string;
let mgr: string;
let crk: string;

beforeAll(async () => {
  ({ db, orgId } = await demoDb());
  mgr = (await facilityByCode(db, "MGR")).id;
  crk = (await facilityByCode(db, "CRK")).id;
  const act = await db.select().from(employees).where(and(eq(employees.employmentStatus, "active"), eq(employees.isRegionalPool, true))).limit(2);
  [empA, empB] = act.map((e) => e.id);
});

const assign = (shift: { id: string; startsAt: Date; endsAt: Date; facilityId: string }, employeeId: string) =>
  db.insert(shiftAssignments).values({ shiftId: shift.id, employeeId, facilityId: shift.facilityId, startsAt: shift.startsAt, endsAt: shift.endsAt, assignedVia: "scheduler" }).returning();

describe("database-level scheduling integrity", () => {
  it("AC10: blocks overlapping shifts for one employee, even across facilities", async () => {
    const s1 = await makeShift(db, orgId, mgr, "2027-02-01T12:00:00Z");
    const s2 = await makeShift(db, orgId, crk, "2027-02-01T18:00:00Z"); // overlaps by 2h
    const s3 = await makeShift(db, orgId, crk, "2027-02-01T20:00:00Z"); // starts exactly when s1 ends
    await assign(s1, empA);
    await expect(assign(s2, empA)).rejects.toThrow();
    await expect(assign(s3, empA)).resolves.toHaveLength(1);
  });

  it("AC12: a single opening can only be filled once; concurrent attempts yield exactly one winner", async () => {
    const s = await makeShift(db, orgId, mgr, "2027-02-03T12:00:00Z", 8, 1);
    const results = await Promise.allSettled([
      db.transaction(async (tx) => tx.insert(shiftAssignments).values({ shiftId: s.id, employeeId: empA, facilityId: mgr, startsAt: s.startsAt, endsAt: s.endsAt, assignedVia: "marketplace" })),
      db.transaction(async (tx) => tx.insert(shiftAssignments).values({ shiftId: s.id, employeeId: empB, facilityId: mgr, startsAt: s.startsAt, endsAt: s.endsAt, assignedVia: "marketplace" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason?.cause?.message ?? rejected.reason)).toMatch(/SHIFT_FULL/);
  });

  it("supports multiple openings within a shift", async () => {
    const s = await makeShift(db, orgId, mgr, "2027-02-05T12:00:00Z", 8, 2);
    await assign(s, empA);
    await expect(assign(s, empB)).resolves.toHaveLength(1);
  });

  it("copies the authoritative time window from the shift (clients can't spoof it)", async () => {
    const s = await makeShift(db, orgId, mgr, "2027-02-07T12:00:00Z");
    const [row] = await db
      .insert(shiftAssignments)
      .values({ shiftId: s.id, employeeId: empA, facilityId: crk, startsAt: new Date("2030-01-01"), endsAt: new Date("2030-01-02"), assignedVia: "scheduler" })
      .returning();
    expect(row.startsAt.toISOString()).toBe(s.startsAt.toISOString());
    expect(row.facilityId).toBe(mgr);
  });

  it("AC17: employees and assignments can never be hard-deleted", async () => {
    await expect(db.delete(employees).where(eq(employees.id, empA))).rejects.toThrow();
    await expect(db.delete(shiftAssignments).where(eq(shiftAssignments.employeeId, empA))).rejects.toThrow();
  });

  it("the audit log is append-only", async () => {
    const [row] = await db.select().from(auditLogs).limit(1);
    await expect(db.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, row.id))).rejects.toThrow();
    await expect(db.delete(auditLogs).where(eq(auditLogs.id, row.id))).rejects.toThrow();
  });
});
