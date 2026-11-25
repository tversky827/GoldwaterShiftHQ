import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLogs, employeePositions, employees, positions, shifts, shiftTemplates, timekeepingRecords } from "@/db/schema";
import { addDaysStr, localDate, weekStartOf } from "@/lib/tz";
import { claimShift } from "@/server/marketplace/claims";
import { publishOpenShifts } from "@/server/marketplace/listings";
import { recordCallout } from "@/server/marketplace/callouts";
import { buildSheets, exportReport, toCsv } from "@/server/report-exports";
import { laborReport, resolvePeriod } from "@/server/reports";
import type { Actor } from "@/server/rbac/access";
import { assignEmployee } from "@/server/scheduling/assignments";
import { evaluateAssignment } from "@/server/scheduling/rules";
import { ensureWeek } from "@/server/scheduling/schedules";
import { actorFor, ctxFor, demoDb, facilityByCode } from "./helpers";

let db: Db;
let orgId: string;
let corp: Actor, admin: Actor, regional: Actor, scheduler: Actor, emp: Actor;
let mgr: { id: string; timezone: string };
const tz = "America/New_York";
const today = localDate(new Date(), tz);
const W = addDaysStr(weekStartOf(today, 0), 70); // a clean future week (Sunday start)

async function shiftOn(date: string, code: string, pos: string) {
  const [r] = await db
    .select({ s: shifts })
    .from(shifts)
    .innerJoin(shiftTemplates, eq(shiftTemplates.id, shifts.shiftTemplateId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(and(eq(shifts.facilityId, mgr.id), eq(shifts.workDate, date), eq(shiftTemplates.code, code), eq(positions.code, pos)));
  return r.s;
}

async function cleanCna() {
  const rows = await db
    .select({ id: employees.id, type: employees.employmentType })
    .from(employees)
    .innerJoin(employeePositions, eq(employeePositions.employeeId, employees.id))
    .innerJoin(positions, eq(positions.id, employeePositions.positionId))
    .where(and(eq(employees.homeFacilityId, mgr.id), eq(employees.employmentStatus, "active"), eq(positions.code, "CNA"), eq(employees.isRegionalPool, false), eq(employees.employmentType, "full_time")));
  const probe = await shiftOn(W, "DAY", "CNA");
  for (const r of rows) if ((await evaluateAssignment(db, { employeeId: r.id, shiftId: probe.id })).outcome === "ok") return r.id;
  throw new Error("no clean CNA");
}

beforeAll(async () => {
  ({ db, orgId } = await demoDb());
  [corp, admin, regional, scheduler, emp] = await Promise.all(["corporate", "administrator", "regional", "scheduler", "employee"].map((n) => actorFor(db, `${n}@demo.test`)));
  mgr = await facilityByCode(db, "MGR");
  await ensureWeek(db, corp, ctxFor(corp), mgr.id, W);
});

describe("periods", () => {
  it("resolves presets in the organization's workweek", () => {
    const now = new Date("2026-11-25T15:00:00Z"); // a Wednesday
    expect(resolvePeriod({ preset: "this_week" }, tz, 0, now)).toMatchObject({ from: "2026-11-22", to: "2026-11-28", days: 7 });
    expect(resolvePeriod({ preset: "last_week" }, tz, 0, now)).toMatchObject({ from: "2026-11-15", to: "2026-11-21" });
    expect(resolvePeriod({ preset: "last_4_weeks" }, tz, 0, now)).toMatchObject({ from: "2026-10-25", to: "2026-11-21", days: 28 });
    expect(() => resolvePeriod({ preset: "custom", from: "2026-11-10", to: "2026-11-01" }, tz, 0, now)).toThrow(/start date/);
  });
});

describe("labor report", () => {
  it("budget, required, scheduled, clocked and fill rate add up for a known week", async () => {
    const filter = { preset: "custom" as const, from: W, to: addDaysStr(W, 6), facilityId: mgr.id };
    const before = await laborReport(db, corp, filter);
    const f0 = before.facilities[0];
    // Shifts were generated from the same budget, so required = budget.
    expect(f0.budgetHours).toBeGreaterThan(0);
    expect(f0.requiredHours).toBe(f0.budgetHours);
    expect(f0.scheduledHours).toBe(0);
    expect(f0.fillRate).toBe(0);

    const id = await cleanCna();
    const s = await shiftOn(addDaysStr(W, 1), "DAY", "CNA");
    expect((await assignEmployee(db, corp, ctxFor(corp), { shiftId: s.id, employeeId: id })).status).toBe("assigned");
    await db.insert(timekeepingRecords).values({ organizationId: orgId, externalId: "test-punch-1", employeeId: id, facilityId: mgr.id, workDate: addDaysStr(W, 1), hours: "7.5", approved: true, source: "demo" });

    const after = (await laborReport(db, corp, filter)).facilities[0];
    expect(after.scheduledHours).toBe(Number(s.paidHours));
    expect(after.filledSlots).toBe(1);
    expect(after.fillRate).toBe(Math.round((1 / after.requiredSlots) * 1000) / 10);
    expect(after.clockedHours).toBe(7.5);
    expect(after.approvedHours).toBe(7.5);
  });

  it("estimates overtime per person per workweek across facilities", async () => {
    const id = await cleanCna();
    const week = addDaysStr(W, 0);
    // Six 8-hour shifts in one workweek = 48 h; the example rule's threshold is 40.
    for (let d = 0; d < 6; d++) {
      const s = await shiftOn(addDaysStr(week, d), "EVE", "CNA");
      const r = await assignEmployee(db, corp, ctxFor(corp), { shiftId: s.id, employeeId: id, explanation: "Test: approved overtime" });
      expect(r.status).toBe("assigned");
    }
    const r = await laborReport(db, corp, { preset: "custom", from: W, to: addDaysStr(W, 6), facilityId: mgr.id });
    const row = r.overtime.find((o) => o.employeeId === id)!;
    expect(row.hours).toBeGreaterThanOrEqual(48);
    expect(row.overtime).toBe(Math.round((row.hours - r.overtimeThreshold!) * 10) / 10);
    expect(r.facilities[0].overtimeHours).toBeGreaterThanOrEqual(row.overtime - 0.1);
    expect(r.rulesConfirmed).toBe(false);
  });

  it("time to fill and callout coverage", async () => {
    const t = localDate(new Date(), tz);
    const [cna] = await db.select().from(positions).where(and(eq(positions.organizationId, orgId), eq(positions.code, "CNA")));
    const start = new Date(Date.now() + 5 * 86_400_000);
    const [s] = await db.insert(shifts).values({ facilityId: mgr.id, positionId: cna.id, workDate: localDate(start, tz), startsAt: start, endsAt: new Date(start.getTime() + 8 * 3_600_000), paidHours: "8", requiredCount: 1, source: "manual" }).returning();
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id] });
    const claim = await claimShift(db, emp, ctxFor(emp), listingIds[0]);
    const filter = { preset: "custom" as const, from: addDaysStr(t, -1), to: addDaysStr(t, 1), facilityId: mgr.id };
    const r = await laborReport(db, corp, filter);
    expect(r.facilities[0].listingsPublished).toBeGreaterThanOrEqual(1);
    expect(claim.status).toBe("assigned");
    {
      expect(r.facilities[0].listingsFilled).toBeGreaterThanOrEqual(1);
      expect(r.totals.medianHoursToFill).not.toBeNull();
      // Callout on that shift, then measure.
      const [a] = await db.select().from((await import("@/db/schema")).shiftAssignments).where(eq((await import("@/db/schema")).shiftAssignments.shiftId, s.id));
      await recordCallout(db, scheduler, ctxFor(scheduler), a.id, "Sick (test)");
      const r2 = await laborReport(db, corp, filter);
      expect(r2.facilities[0].callouts).toBeGreaterThanOrEqual(1);
    }
  });

  it("respects scope: a facility administrator sees only their facility; schedulers have no reports", async () => {
    const a = await laborReport(db, admin, { preset: "last_week" });
    expect(a.facilities.map((f) => f.code)).toEqual(["MGR"]);
    expect((await laborReport(db, regional, { preset: "last_week" })).facilities.length).toBe(4);
    expect((await laborReport(db, corp, { preset: "last_week" })).facilities.length).toBe(11);
    await expect(laborReport(db, scheduler, {})).rejects.toThrow(/permission/);
    const crk = await facilityByCode(db, "CRK");
    await expect(laborReport(db, admin, { facilityId: crk.id })).rejects.toThrow(/permission/);
  });
});

describe("exports", () => {
  it("CSV: header row, escaping, spreadsheet-formula guard, and a byte-order mark", () => {
    const csv = toCsv({ key: "x", name: "X", columns: [{ header: "Name" }, { header: "Rate", numFmt: "0.0%" }], rows: [['Smith, "Jo"', 0.875], ["=HYPERLINK(1)", null]] });
    expect(csv.startsWith("﻿Name,Rate\r\n")).toBe(true);
    expect(csv).toContain('"Smith, ""Jo""",87.5');
    expect(csv).toContain("'=HYPERLINK(1),");
  });

  it("Excel workbook has every report plus an About sheet, and the export is audited", async () => {
    const out = await exportReport(db, corp, ctxFor(corp), { filter: { preset: "custom", from: W, to: addDaysStr(W, 6) }, format: "xlsx" });
    expect(out.filename).toMatch(/^shifthq-labor-report-all-facilities-.*\.xlsx$/);
    const buf = out.body as Buffer;
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Coverage", "Overtime", "Open shifts", "Callouts", "About"]);
    const sum = wb.getWorksheet("Summary")!;
    expect(sum.getRow(1).getCell(1).value).toBe("Facility");
    expect(sum.rowCount).toBe(1 + 11 + 1); // header + facilities + total
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "report.exported"));
    expect(logs.length).toBe(1);
    expect(JSON.stringify(logs[0].after)).toContain('"format":"xlsx"');
  });

  it("CSV of one report; export permission and scope are enforced", async () => {
    const out = await exportReport(db, admin, ctxFor(admin), { filter: { preset: "custom", from: W, to: addDaysStr(W, 6) }, format: "csv", sheet: "coverage" });
    expect(out.filename).toMatch(/^shifthq-coverage-all-facilities-/);
    const lines = String(out.body).trim().split("\r\n");
    expect(lines[0]).toContain("Facility,Date,Starts,Ends,Position");
    expect(lines.slice(1).every((l) => l.startsWith("MGR,"))).toBe(true);
    const crk = await facilityByCode(db, "CRK");
    await expect(exportReport(db, admin, ctxFor(admin), { filter: { facilityId: crk.id }, format: "csv" })).rejects.toThrow(/permission/);
    const don = await actorFor(db, "don@demo.test"); // has reports.view but not reports.export
    await expect(exportReport(db, don, ctxFor(don), { filter: {}, format: "csv" })).rejects.toThrow(/permission/);
    expect(buildSheets(await laborReport(db, admin, {})).map((s) => s.key)).toEqual(["summary", "coverage", "overtime", "open_shifts", "callouts"]);
  });
});
