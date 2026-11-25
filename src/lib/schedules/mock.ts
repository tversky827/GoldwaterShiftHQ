/**
 * MOCK schedules. Schedules are owned by SNF Workforce (this platform).
 * Until the scheduling module exists, these fake shifts let the
 * scheduled-vs-clocked reconciliation run end to end.
 */
import type { Employee, ScheduledShift } from "../store/types";
import { addDays, at, startOfWorkweek, ymd } from "../time";

export function mockSchedules(employees: Employee[], now = new Date()): ScheduledShift[] {
  const wk = startOfWorkweek(now);
  const byNum = (n: string) => employees.find((e) => e.employeeNumber === n && e.isMock);
  const shift = (n: string, facility: string, dayIdx: number, s: number, end: number): ScheduledShift | null => {
    const emp = byNum(n);
    if (!emp) return null;
    const day = addDays(wk, dayIdx);
    return { id: `MOCK-S-${n}-${ymd(day)}`, employeeId: emp.id, facility, start: at(day, s), end: at(end >= 24 ? addDays(day, 1) : day, end % 24) };
  };
  return [
    shift("1001", "Maple Grove SNF", 0, 7, 15),
    shift("1001", "Maple Grove SNF", 1, 7, 15),
    shift("1002", "Maple Grove SNF", 0, 7, 19),
    shift("1002", "Maple Grove SNF", 1, 7, 19),
    // 1002 day 2 intentionally NOT scheduled
    shift("1003", "Cedar Ridge SNF", 0, 15, 23),
    shift("1003", "Cedar Ridge SNF", 1, 15, 23), // will have no punch
    shift("1007", "Maple Grove SNF", 0, 7, 15),
    shift("1010", "Oak Hollow SNF", 1, 7, 15),
  ].filter((x): x is ScheduledShift => x !== null);
}
