import { describe, expect, it } from "vitest";
import { MOCK_AOD_EMPLOYEES, mockAttendance } from "@/lib/integrations/aod/mock";
import { MOCK_PAYCOR_EMPLOYEES } from "@/lib/integrations/paycor/mock";
import { findExceptions } from "@/lib/reconciliation/exceptions";
import { matchEmployees } from "@/lib/reconciliation/matching";
import { mockSchedules } from "@/lib/schedules/mock";
import type { AttendanceRecord, Employee } from "@/lib/store/types";

// A fixed Wednesday evening so tests are deterministic.
const NOW = new Date(2026, 10, 25, 20, 0, 0);
const employees: Employee[] = MOCK_PAYCOR_EMPLOYEES.map((e, i) => ({ ...e, id: `E${i}`, lastSyncedAt: NOW.toISOString() }));
const attendance: AttendanceRecord[] = mockAttendance(NOW).map((a) => ({ ...a, importedAt: NOW.toISOString() }));
const schedules = mockSchedules(employees, NOW);

describe("employee matching", () => {
  const r = matchEmployees(employees, MOCK_AOD_EMPLOYEES, attendance, "employeeNumber", 14, NOW);
  const types = (t: string) => r.issues.filter((i) => i.type === t);

  it("matches by employee number", () => {
    expect(r.keyToEmployee.get("1001")?.paycorEmployeeId).toBe("MOCK-P1001");
  });
  it("flags missing IDs in both systems", () => {
    expect(types("missing_id_paycor")).toHaveLength(1);
    expect(types("missing_id_aod")).toHaveLength(1);
  });
  it("flags duplicates and refuses to link them", () => {
    expect(types("duplicate_paycor")[0].key).toBe("1007");
    expect(r.keyToEmployee.has("1007")).toBe(false);
  });
  it("flags AOD employees not in Paycor and never creates them", () => {
    expect(types("unmatched_aod").map((i) => i.key)).toEqual(["2001"]);
    expect(employees.some((e) => e.employeeNumber === "2001")).toBe(false);
  });
  it("flags inactive/terminated employees with recent punches", () => {
    expect(types("inactive_with_recent_punches").map((i) => i.key)).toEqual(["1004"]);
  });
  it("flags facility mismatch", () => {
    expect(types("facility_mismatch").map((i) => i.key)).toContain("1005");
  });
  it("normalizes leading zeros", () => {
    const m = matchEmployees([{ ...employees[0], employeeNumber: "001001" }], [{ ...MOCK_AOD_EMPLOYEES[0], employeeNumber: "1001" }], [], "employeeNumber", 14, NOW);
    expect(m.matched).toHaveLength(1);
  });
});

describe("timekeeping exceptions", () => {
  const m = matchEmployees(employees, MOCK_AOD_EMPLOYEES, attendance, "employeeNumber", 14, NOW);
  const ex = findExceptions(employees, m.keyToEmployee, attendance, schedules, { now: NOW });
  const of = (t: string) => ex.filter((x) => x.type === t);

  it("clocked in but not scheduled", () => {
    expect(of("clocked_not_scheduled").some((x) => x.employeeName === "Jordan Testcase")).toBe(true);
  });
  it("scheduled but no punch", () => {
    expect(of("scheduled_no_punch").some((x) => x.employeeName === "Riley Demo")).toBe(true);
  });
  it("unauthorized facility", () => {
    expect(of("unauthorized_facility").map((x) => x.employeeName)).toContain("Morgan Fixture");
  });
  it("approaching overtime", () => {
    expect(of("approaching_overtime").map((x) => x.employeeName)).toContain("Jordan Testcase");
  });
  it("missing punch out", () => {
    expect(of("missing_punch").map((x) => x.employeeName)).toContain("Drew Stub");
  });
  it("unusually long shift", () => {
    // 1007 is a duplicate so unmatched -> appears as unmatched record, not long shift
    expect(of("unmatched_record").map((x) => x.key)).toEqual(expect.arrayContaining(["1007", "2001"]));
  });
  it("long shift for a matched employee", () => {
    const longRec: AttendanceRecord = { ...attendance[0], id: "x", punchIn: new Date(2026, 10, 23, 5).toISOString(), punchOut: new Date(2026, 10, 23, 23).toISOString() };
    const e2 = findExceptions(employees, m.keyToEmployee, [longRec], [], { now: NOW });
    expect(e2.some((x) => x.type === "long_shift")).toBe(true);
  });
});
