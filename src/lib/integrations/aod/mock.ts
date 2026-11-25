/**
 * MOCK Attendance on Demand data, generated relative to the current week.
 * Contains deliberate problem cases so every exception report has something
 * to show. Never mixed with real data (isMock = true).
 */
import type { AodEmployee, AttendanceRecord } from "../../store/types";
import { addDays, at, startOfWorkweek, ymd } from "../../time";
import type { AodSource, ConnectionTestResult } from "../types";

const e = (n: string | undefined, first: string, last: string, facility: string, active = true): AodEmployee => ({
  aodId: `MOCK-A${n ?? first}`, employeeNumber: n, firstName: first, lastName: last, active, homeFacility: facility, isMock: true,
});

export const MOCK_AOD_EMPLOYEES: AodEmployee[] = [
  e("1001", "Avery", "Sample", "Maple Grove SNF"),
  e("1002", "Jordan", "Testcase", "Maple Grove SNF"),
  e("1003", "Riley", "Demo", "Cedar Ridge SNF"),
  e("1004", "Casey", "Placeholder", "Cedar Ridge SNF"), // terminated in Paycor but still active in AOD
  e("1005", "Morgan", "Fixture", "Maple Grove SNF"), // facility differs from Paycor (Oak Hollow)
  e("1007", "Quinn", "Example", "Maple Grove SNF"),
  e("1009", "Skyler", "Mockford", "Cedar Ridge SNF"),
  e("1010", "Drew", "Stub", "Oak Hollow SNF"),
  e("2001", "Pat", "Unknownperson", "Oak Hollow SNF"), // not in Paycor
  e(undefined, "Lee", "Noid", "Oak Hollow SNF"), // missing employee number
];

export function mockAttendance(now = new Date()): Omit<AttendanceRecord, "importedAt">[] {
  const wk = startOfWorkweek(now);
  const d = (i: number) => addDays(wk, i);
  const rec = (key: string, facility: string, day: Date, inH: number, outH?: number, approved = false): Omit<AttendanceRecord, "importedAt"> => {
    const punchIn = at(day, inH);
    const punchOut = outH === undefined ? undefined : at(outH >= 24 ? addDays(day, 1) : day, outH % 24);
    return {
      id: `MOCK-${key}-${ymd(day)}-${inH}`,
      aodEmployeeKey: key, facility, workDate: ymd(day), punchIn, punchOut,
      hours: punchOut ? (Date.parse(punchOut) - Date.parse(punchIn)) / 3_600_000 : undefined,
      approved, isMock: true,
    };
  };
  return [
    rec("1001", "Maple Grove SNF", d(0), 7, 15, true),
    rec("1001", "Maple Grove SNF", d(1), 7, 15, true),
    // 1002: heavy week (approaching overtime) + an unscheduled day
    rec("1002", "Maple Grove SNF", d(0), 7, 19, true),
    rec("1002", "Maple Grove SNF", d(1), 7, 19, true),
    rec("1002", "Maple Grove SNF", d(2), 7, 19),
    // 1003: scheduled day 1 but no punch (missing punch / no-show)
    rec("1003", "Cedar Ridge SNF", d(0), 15, 23),
    // 1004: terminated in Paycor, still punching
    rec("1004", "Cedar Ridge SNF", d(1), 7, 15),
    // 1005: worked at Maple Grove though home facility (Paycor) is Oak Hollow and not scheduled there
    rec("1005", "Maple Grove SNF", d(1), 7, 15),
    // 1007: unusually long shift (17h)
    rec("1007", "Maple Grove SNF", d(0), 6, 23),
    // 1010: punched in, never punched out
    rec("1010", "Oak Hollow SNF", d(1), 7),
    // 2001: unknown to Paycor
    rec("2001", "Oak Hollow SNF", d(1), 7, 15),
  ];
}

export class MockAodSource implements AodSource {
  readonly label = "Attendance on Demand (MOCK - fake data)";
  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Mock mode: no real Attendance on Demand connection is being made. Fake punches are used." };
  }
  async fetchEmployees() {
    return MOCK_AOD_EMPLOYEES.map((x) => ({ ...x }));
  }
  async fetchAttendance() {
    return mockAttendance();
  }
}
