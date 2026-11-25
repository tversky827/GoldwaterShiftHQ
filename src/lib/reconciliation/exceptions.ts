/**
 * Timekeeping vs scheduling exception report. READ-ONLY: this never edits
 * punches or submits payroll adjustments - it only lists items for review.
 */
import type { AttendanceRecord, Employee, ScheduledShift } from "../store/types";
import { hoursBetween, startOfWorkweek } from "../time";
import { normalizeKey } from "./matching";

export type ExceptionType =
  | "clocked_not_scheduled"
  | "scheduled_no_punch"
  | "unauthorized_facility"
  | "approaching_overtime"
  | "over_overtime"
  | "missing_punch"
  | "long_shift"
  | "unmatched_record";

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  clocked_not_scheduled: "Clocked in but not scheduled",
  scheduled_no_punch: "Scheduled but no punch",
  unauthorized_facility: "Worked at unauthorized facility",
  approaching_overtime: "Approaching overtime",
  over_overtime: "In overtime",
  missing_punch: "Missing punch (in or out)",
  long_shift: "Unusually long shift",
  unmatched_record: "Timekeeping record not matched to an employee",
};

export interface TimeException {
  type: ExceptionType;
  severity: "high" | "medium" | "low";
  employeeName?: string;
  key?: string;
  date?: string;
  facility?: string;
  message: string;
}

export interface ExceptionOptions {
  now?: Date;
  overtimeThreshold?: number; // weekly hours
  overtimeWarning?: number; // weekly hours
  longShiftHours?: number;
  /** Shifts within this many hours of a punch are considered "the same" shift. */
  matchToleranceHours?: number;
  /** How long after a shift starts before "no punch" is reported. */
  noShowGraceMinutes?: number;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number, tolMs: number) =>
  aStart < bEnd + tolMs && bStart < aEnd + tolMs;

export function findExceptions(
  employees: Employee[],
  keyToEmployee: Map<string, Employee>,
  attendance: AttendanceRecord[],
  schedules: ScheduledShift[],
  opts: ExceptionOptions = {},
): TimeException[] {
  const now = opts.now ?? new Date();
  const otLimit = opts.overtimeThreshold ?? 40;
  const otWarn = opts.overtimeWarning ?? 36;
  const longShift = opts.longShiftHours ?? 16;
  const tolMs = (opts.matchToleranceHours ?? 2) * 3_600_000;
  const graceMs = (opts.noShowGraceMinutes ?? 30) * 60_000;
  const out: TimeException[] = [];
  const nm = (e: Employee) => `${e.firstName} ${e.lastName}`;
  const empById = new Map(employees.map((e) => [e.id, e]));
  const shiftsByEmp = new Map<string, ScheduledShift[]>();
  for (const s of schedules) shiftsByEmp.set(s.employeeId, [...(shiftsByEmp.get(s.employeeId) ?? []), s]);

  const attByEmp = new Map<string, AttendanceRecord[]>();
  for (const r of attendance) {
    const emp = keyToEmployee.get(normalizeKey(r.aodEmployeeKey));
    if (!emp) {
      out.push({ type: "unmatched_record", severity: "high", key: r.aodEmployeeKey || "(blank)", date: r.workDate, facility: r.facility, message: `Punch on ${r.workDate} for AOD employee "${r.aodEmployeeKey || "(blank)"}" cannot be matched to a Paycor employee.` });
      continue;
    }
    attByEmp.set(emp.id, [...(attByEmp.get(emp.id) ?? []), r]);

    // Missing punch
    if (r.punchIn && !r.punchOut && Date.parse(r.punchIn) < now.getTime() - longShift * 3_600_000) {
      out.push({ type: "missing_punch", severity: "high", employeeName: nm(emp), date: r.workDate, facility: r.facility, message: `${nm(emp)} punched in on ${r.workDate} but has no punch out.` });
    }
    if (!r.punchIn && r.punchOut) {
      out.push({ type: "missing_punch", severity: "high", employeeName: nm(emp), date: r.workDate, facility: r.facility, message: `${nm(emp)} has a punch out on ${r.workDate} with no punch in.` });
    }
    // Long shift
    if (r.punchIn && r.punchOut && hoursBetween(r.punchIn, r.punchOut) > longShift) {
      out.push({ type: "long_shift", severity: "medium", employeeName: nm(emp), date: r.workDate, facility: r.facility, message: `${nm(emp)} worked ${hoursBetween(r.punchIn, r.punchOut).toFixed(1)} hours on ${r.workDate} (over ${longShift}).` });
    }

    const pStart = Date.parse(r.punchIn ?? r.punchOut ?? r.workDate);
    const pEnd = Date.parse(r.punchOut ?? r.punchIn ?? r.workDate);
    const myShifts = shiftsByEmp.get(emp.id) ?? [];
    const matching = myShifts.filter((s) => overlaps(pStart, pEnd, Date.parse(s.start), Date.parse(s.end), tolMs));
    if (!matching.length) {
      out.push({ type: "clocked_not_scheduled", severity: "medium", employeeName: nm(emp), date: r.workDate, facility: r.facility, message: `${nm(emp)} clocked in at ${r.facility ?? "unknown facility"} on ${r.workDate} without a scheduled shift.` });
    }
    // Unauthorized facility: not home facility, not regional pool, and not scheduled there.
    const scheduledHere = matching.some((s) => r.facility && s.facility.toLowerCase() === r.facility.toLowerCase());
    const isHome = !!(r.facility && emp.homeFacility && r.facility.toLowerCase() === emp.homeFacility.toLowerCase());
    if (r.facility && emp.homeFacility && !isHome && !scheduledHere && !emp.regionalPool) {
      out.push({ type: "unauthorized_facility", severity: "high", employeeName: nm(emp), date: r.workDate, facility: r.facility, message: `${nm(emp)} worked at ${r.facility} on ${r.workDate}; home facility is ${emp.homeFacility}, not in a regional pool, and not scheduled there.` });
    }
  }

  // Scheduled but no punch
  for (const s of schedules) {
    const emp = empById.get(s.employeeId);
    if (!emp || Date.parse(s.start) + graceMs > now.getTime()) continue;
    const recs = attByEmp.get(emp.id) ?? [];
    const hit = recs.some((r) => overlaps(Date.parse(r.punchIn ?? r.punchOut ?? r.workDate), Date.parse(r.punchOut ?? r.punchIn ?? r.workDate), Date.parse(s.start), Date.parse(s.end), tolMs));
    if (!hit) {
      out.push({ type: "scheduled_no_punch", severity: "high", employeeName: nm(emp), date: s.start.slice(0, 10), facility: s.facility, message: `${nm(emp)} was scheduled at ${s.facility} starting ${new Date(s.start).toLocaleString()} but has no punch.` });
    }
  }

  // Overtime: actual worked this week + remaining scheduled shifts (projection)
  const wkStart = startOfWorkweek(now).getTime();
  const wkEnd = wkStart + 7 * 86_400_000;
  for (const emp of employees) {
    const worked = (attByEmp.get(emp.id) ?? [])
      .filter((r) => r.punchIn && r.punchOut && Date.parse(r.punchIn) >= wkStart && Date.parse(r.punchIn) < wkEnd)
      .reduce((sum, r) => sum + hoursBetween(r.punchIn!, r.punchOut!), 0);
    const remaining = (shiftsByEmp.get(emp.id) ?? [])
      .filter((s) => Date.parse(s.start) > now.getTime() && Date.parse(s.start) < wkEnd)
      .reduce((sum, s) => sum + hoursBetween(s.start, s.end), 0);
    const projected = worked + remaining;
    if (worked > otLimit) {
      out.push({ type: "over_overtime", severity: "high", employeeName: nm(emp), message: `${nm(emp)} has worked ${worked.toFixed(1)} hours this week (over ${otLimit}).` });
    } else if (worked >= otWarn || projected > otLimit) {
      out.push({ type: "approaching_overtime", severity: "medium", employeeName: nm(emp), message: `${nm(emp)}: ${worked.toFixed(1)} hours worked this week, ${projected.toFixed(1)} projected with remaining scheduled shifts (limit ${otLimit}).` });
    }
  }

  return out;
}

export interface HoursComparisonRow {
  employeeName: string;
  scheduled: number;
  clocked: number;
  approved: number;
  /** Paycor payroll hours: null until a payroll-hours endpoint is verified. */
  payroll: number | null;
  projectedOvertime: number;
  actualOvertime: number;
}

export function hoursComparison(
  employees: Employee[],
  keyToEmployee: Map<string, Employee>,
  attendance: AttendanceRecord[],
  schedules: ScheduledShift[],
  now = new Date(),
  otLimit = 40,
): HoursComparisonRow[] {
  const wkStart = startOfWorkweek(now).getTime();
  const wkEnd = wkStart + 7 * 86_400_000;
  const inWeek = (iso?: string) => !!iso && Date.parse(iso) >= wkStart && Date.parse(iso) < wkEnd;
  return employees
    .map((emp) => {
      const sch = schedules.filter((s) => s.employeeId === emp.id && inWeek(s.start));
      const att = attendance.filter((r) => keyToEmployee.get(normalizeKey(r.aodEmployeeKey))?.id === emp.id && inWeek(r.punchIn) && r.punchOut);
      const scheduled = sch.reduce((s, x) => s + hoursBetween(x.start, x.end), 0);
      const clocked = att.reduce((s, r) => s + hoursBetween(r.punchIn!, r.punchOut!), 0);
      const approved = att.filter((r) => r.approved).reduce((s, r) => s + (r.hours ?? hoursBetween(r.punchIn!, r.punchOut!)), 0);
      const remaining = sch.filter((s) => Date.parse(s.start) > now.getTime()).reduce((s, x) => s + hoursBetween(x.start, x.end), 0);
      return {
        employeeName: `${emp.firstName} ${emp.lastName}`,
        scheduled, clocked, approved, payroll: null,
        projectedOvertime: Math.max(0, clocked + remaining - otLimit),
        actualOvertime: Math.max(0, clocked - otLimit),
      };
    })
    .filter((r) => r.scheduled || r.clocked);
}
