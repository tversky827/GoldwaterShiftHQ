import { and, count, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLogs, employeePositions, employees, integrationFieldMappings, integrationSyncLogs, marketplaceListings, positions, shiftAssignments, shiftClaims } from "@/db/schema";
import { DemoPaycorSource, generateDemoPaycorEmployees } from "@/server/integrations/paycor/demo";
import { normalizeEmploymentType, syncPaycorEmployees } from "@/server/integrations/paycor/sync";
import type { PaycorEmployeeRecord, PaycorSource } from "@/server/integrations/paycor/types";
import { demoDb, facilityByCode, makeShift } from "./helpers";

let db: Db;
let orgId: string;
let feed: PaycorEmployeeRecord[];

beforeAll(async () => {
  ({ db, orgId } = await demoDb());
  feed = generateDemoPaycorEmployees();
});

const sourceOf = (records: PaycorEmployeeRecord[]): PaycorSource => new DemoPaycorSource(records);
const run = (source: PaycorSource) => syncPaycorEmployees(db, { organizationId: orgId, source, trigger: "manual" });
const byPaycor = async (id: string) => (await db.select().from(employees).where(eq(employees.paycorEmployeeId, id)))[0];

describe("Paycor employee sync", () => {
  it("AC1: an active Paycor employee appears in the platform, placed in the right facility, department and position", async () => {
    const r = feed.find((x) => x.status === "active" && x.location === "Maple Grove - Dayton" && x.position === "Certified Nursing Assistant")!;
    const e = await byPaycor(r.paycorEmployeeId);
    expect(e).toBeDefined();
    expect(e.employmentStatus).toBe("active");
    expect(e.homeFacilityId).toBe((await facilityByCode(db, "MGR")).id);
    expect(e.id).not.toBe(r.paycorEmployeeId); // internal UUID, separate from Paycor ID
    const [pos] = await db.select({ code: positions.code }).from(employeePositions).innerJoin(positions, eq(positions.id, employeePositions.positionId)).where(eq(employeePositions.employeeId, e.id));
    expect(pos.code).toBe("CNA");
  });

  it("maps Paycor departments through the mapping table (Environmental Services → Housekeeping)", async () => {
    const r = feed.find((x) => x.department === "Environmental Services" && x.location === "Maple Grove - Dayton")!;
    const e = await byPaycor(r.paycorEmployeeId);
    expect(e.homeDepartmentId).not.toBeNull();
  });

  it("places an employee by legal entity when the Paycor location doesn't match, and reports unmapped legal entities", async () => {
    const base = feed.find((x) => x.status === "active")!;
    const mgr = await facilityByCode(db, "MGR");
    await db.insert(integrationFieldMappings).values({ organizationId: orgId, provider: "paycor", sourceType: "legal_entity", sourceValue: "164922", facilityId: mgr.id });
    const placed = { ...base, paycorEmployeeId: "LE-1", employeeNumber: "LE0001", legalEntityId: "164922", location: "Somewhere Unknown" };
    const lost = { ...base, paycorEmployeeId: "LE-2", employeeNumber: "LE0002", legalEntityId: "999999", location: "Somewhere Unknown" };
    const out = await run(sourceOf([...feed, placed, lost]));
    expect(out.ok).toBe(true);
    expect((await byPaycor("LE-1")).homeFacilityId).toBe(mgr.id);
    expect((await byPaycor("LE-2")).homeFacilityId).toBeNull();
    const [logRow] = await db.select().from(integrationSyncLogs).where(eq(integrationSyncLogs.id, out.syncLogId!));
    const unmapped = (logRow.details as { unmapped: { legalEntities: Record<string, number> } }).unmapped;
    expect(unmapped.legalEntities["999999"]).toBe(1);
    expect(unmapped.legalEntities["164922"]).toBeUndefined();
  });

  it("is idempotent: re-running with identical data changes nothing", async () => {
    const before = (await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.action, "employee.updated_from_paycor")))[0].n;
    const out = await run(sourceOf(feed));
    expect(out.ok).toBe(true);
    expect(out.counts!.created).toBe(0);
    expect(out.counts!.updated).toBe(0);
    expect(out.counts!.unchanged).toBeGreaterThan(300);
    const after = (await db.select({ n: count() }).from(auditLogs).where(eq(auditLogs.action, "employee.updated_from_paycor")))[0].n;
    expect(after).toBe(before);
  });

  it("AC20: a Paycor outage during fetch changes nothing and records the failure", async () => {
    const snapshot = await db.select({ n: count() }).from(employees);
    const failing: PaycorSource = { label: "x", isDemo: true, testConnection: async () => ({ ok: false, message: "" }), fetchEmployees: async () => { throw new Error("Connection reset by peer"); } };
    const out = await run(failing);
    expect(out.ok).toBe(false);
    expect((await db.select({ n: count() }).from(employees))[0].n).toBe(snapshot[0].n);
    const [logRow] = await db.select().from(integrationSyncLogs).where(eq(integrationSyncLogs.id, out.syncLogId!));
    expect(logRow.status).toBe("failed");
    expect(logRow.errorSummary).toContain("Connection reset");
  });

  it("AC20: a failure while applying rolls back the whole batch", async () => {
    const changed = feed.map((r, i) => (i === 0 ? { ...r, firstName: "Changed" } : r));
    changed.push({ ...feed[10], paycorEmployeeId: "DEMO-BAD", hireDate: "not-a-date" }); // DB will reject
    const out = await run(sourceOf(changed));
    expect(out.ok).toBe(false);
    expect((await byPaycor(feed[0].paycorEmployeeId)).firstName).toBe(feed[0].firstName); // not "Changed"
    expect(await byPaycor("DEMO-BAD")).toBeUndefined();
  });

  it("does not deactivate employees who are simply missing from a (possibly partial) feed", async () => {
    const out = await run(sourceOf(feed.slice(0, 20)));
    expect(out.ok).toBe(true);
    const missing = await byPaycor(feed[100].paycorEmployeeId);
    expect(missing.employmentStatus).toBe(feed[100].status === "unknown" ? "inactive" : feed[100].status);
  });

  it("never overwrites SNF Workforce-owned fields (regional pool classification)", async () => {
    const pool = (await db.select().from(employees).where(eq(employees.isRegionalPool, true)))[0];
    await run(sourceOf(feed));
    expect((await db.select().from(employees).where(eq(employees.id, pool.id)))[0].isRegionalPool).toBe(true);
  });

  it("AC2/AC17: termination in Paycor deactivates, cancels pending claims, blocks new assignments, and preserves history", async () => {
    const target = feed.find((x) => x.status === "active" && x.location === "Maple Grove - Dayton" && x.position === "Certified Nursing Assistant" && x.paycorEmployeeId !== "DEMO-1001")!;
    const emp = await byPaycor(target.paycorEmployeeId);
    const mgr = await facilityByCode(db, "MGR");
    // Historical assignment (completed) and a pending claim on an open listing.
    const past = await makeShift(db, orgId, mgr.id, "2026-10-01T11:00:00Z");
    const [hist] = await db.insert(shiftAssignments).values({ shiftId: past.id, employeeId: emp.id, facilityId: mgr.id, startsAt: past.startsAt, endsAt: past.endsAt, assignedVia: "scheduler" }).returning();
    await db.update(shiftAssignments).set({ status: "completed" }).where(eq(shiftAssignments.id, hist.id));
    const open = await makeShift(db, orgId, mgr.id, "2027-01-05T12:00:00Z");
    const [listing] = await db.insert(marketplaceListings).values({ shiftId: open.id, facilityId: mgr.id, openings: 1 }).returning();
    const [claim] = await db.insert(shiftClaims).values({ listingId: listing.id, shiftId: open.id, employeeId: emp.id }).returning();

    const out = await run(sourceOf(feed.map((r) => (r.paycorEmployeeId === target.paycorEmployeeId ? { ...r, status: "terminated" as const, terminationDate: "2026-11-20" } : r))));
    expect(out.counts!.deactivated).toBe(1);

    const after = await byPaycor(target.paycorEmployeeId);
    expect(after.employmentStatus).toBe("terminated");
    expect((await db.select().from(shiftClaims).where(eq(shiftClaims.id, claim.id)))[0].status).toBe("cancelled");
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, hist.id)))[0]).toBeDefined(); // history kept
    await expect(db.insert(shiftAssignments).values({ shiftId: open.id, employeeId: emp.id, facilityId: mgr.id, startsAt: open.startsAt, endsAt: open.endsAt, assignedVia: "marketplace" })).rejects.toThrow();
    const [evt] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "employee.deactivated"), eq(auditLogs.entityId, emp.id)));
    expect(evt).toBeDefined();
  });

  it("flags duplicate Paycor IDs within one feed instead of importing twice", async () => {
    const out = await run(sourceOf([...feed, feed[0]]));
    expect(out.counts!.skipped).toBeGreaterThanOrEqual(1);
    expect((await db.select({ n: count() }).from(employees).where(eq(employees.paycorEmployeeId, feed[0].paycorEmployeeId)))[0].n).toBe(1);
  });

  it("refuses to run two syncs at once", async () => {
    let release!: () => void;
    const slow: PaycorSource = { label: "slow", isDemo: true, testConnection: async () => ({ ok: true, message: "" }), fetchEmployees: () => new Promise((r) => (release = () => r({ records: feed, legalEntities: [] }))) };
    const first = run(slow);
    await new Promise((r) => setTimeout(r, 50));
    const second = await run(sourceOf(feed));
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/already in progress/);
    release();
    expect((await first).ok).toBe(true);
  });

  it("normalizes employment classes", () => {
    expect(normalizeEmploymentType("Full Time")).toBe("full_time");
    expect(normalizeEmploymentType("Part-Time")).toBe("part_time");
    expect(normalizeEmploymentType("PRN")).toBe("prn");
    expect(normalizeEmploymentType("Per Diem")).toBe("prn");
    expect(normalizeEmploymentType(undefined)).toBe("unknown");
  });

  it("keeps the Paycor ID unique per organization", async () => {
    const r = await db.execute(sql`select paycor_employee_id, count(*) from employees group by 1 having count(*) > 1`);
    expect((r as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });
});
