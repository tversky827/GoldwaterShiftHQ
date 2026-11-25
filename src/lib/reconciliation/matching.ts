/**
 * Matches Attendance on Demand employees to Paycor employees using a common
 * identifier (default: employee number). This NEVER creates employees - an
 * AOD person without a Paycor match is flagged for a human to resolve.
 */
import type { AodEmployee, AttendanceRecord, Employee } from "../store/types";

export type MatchField = "employeeNumber" | "badgeNumber";

export type MatchIssueType =
  | "missing_id_paycor"
  | "missing_id_aod"
  | "duplicate_paycor"
  | "duplicate_aod"
  | "unmatched_aod"
  | "unmatched_paycor_active"
  | "inactive_with_recent_punches"
  | "facility_mismatch";

export interface MatchIssue {
  type: MatchIssueType;
  severity: "high" | "medium" | "low";
  key?: string;
  message: string;
  paycorEmployeeId?: string;
  aodId?: string;
}

export interface MatchResult {
  matched: { key: string; employee: Employee; aod: AodEmployee }[];
  /** key (as AOD reports it) -> Paycor employee, for unambiguous matches only */
  keyToEmployee: Map<string, Employee>;
  issues: MatchIssue[];
}

const norm = (k?: string) => (k ?? "").trim().replace(/^0+(?=\d)/, "").toUpperCase();
const name = (x: { firstName: string; lastName: string }) => `${x.firstName} ${x.lastName}`.trim();

export const ISSUE_LABELS: Record<MatchIssueType, string> = {
  missing_id_paycor: "Missing employee ID (Paycor)",
  missing_id_aod: "Missing employee ID (AOD)",
  duplicate_paycor: "Duplicate record (Paycor)",
  duplicate_aod: "Duplicate record (AOD)",
  unmatched_aod: "In AOD but not in Paycor",
  unmatched_paycor_active: "Active in Paycor but not in AOD",
  inactive_with_recent_punches: "Inactive employee with recent punches",
  facility_mismatch: "Facility differs between systems",
};

export function matchEmployees(
  employees: Employee[],
  aodEmployees: AodEmployee[],
  attendance: AttendanceRecord[],
  field: MatchField = "employeeNumber",
  recentDays = 14,
  now = new Date(),
): MatchResult {
  const issues: MatchIssue[] = [];

  const paycorByKey = new Map<string, Employee[]>();
  for (const e of employees) {
    const k = norm(e[field]);
    if (!k) {
      issues.push({ type: "missing_id_paycor", severity: "high", paycorEmployeeId: e.paycorEmployeeId, message: `${name(e)} has no ${field} in Paycor, so their punches cannot be linked.` });
      continue;
    }
    paycorByKey.set(k, [...(paycorByKey.get(k) ?? []), e]);
  }
  for (const [k, list] of paycorByKey) {
    if (list.length > 1) {
      issues.push({ type: "duplicate_paycor", severity: "high", key: k, message: `${field} ${k} is used by ${list.length} Paycor records (${list.map(name).join(", ")}). Punches for this number will not be linked until fixed.` });
    }
  }

  const aodByKey = new Map<string, AodEmployee[]>();
  for (const a of aodEmployees) {
    const k = norm(a[field]);
    if (!k) {
      issues.push({ type: "missing_id_aod", severity: "high", aodId: a.aodId, message: `${name(a)} has no ${field} in Attendance on Demand.` });
      continue;
    }
    aodByKey.set(k, [...(aodByKey.get(k) ?? []), a]);
  }
  for (const [k, list] of aodByKey) {
    if (list.length > 1) issues.push({ type: "duplicate_aod", severity: "high", key: k, message: `${field} ${k} appears ${list.length} times in Attendance on Demand.` });
  }

  const matched: MatchResult["matched"] = [];
  const keyToEmployee = new Map<string, Employee>();
  for (const [k, aList] of aodByKey) {
    const pList = paycorByKey.get(k);
    if (!pList) {
      issues.push({ type: "unmatched_aod", severity: "high", key: k, aodId: aList[0].aodId, message: `${name(aList[0])} (${field} ${k}) exists in Attendance on Demand but not in Paycor. Do not create them here - check Paycor.` });
      continue;
    }
    if (pList.length > 1 || aList.length > 1) continue; // duplicates already flagged; refuse to guess
    const [p] = pList;
    const [a] = aList;
    matched.push({ key: k, employee: p, aod: a });
    keyToEmployee.set(k, p);
    if (p.homeFacility && a.homeFacility && p.homeFacility.toLowerCase() !== a.homeFacility.toLowerCase()) {
      issues.push({ type: "facility_mismatch", severity: "medium", key: k, paycorEmployeeId: p.paycorEmployeeId, message: `${name(p)}: home facility is "${p.homeFacility}" in Paycor but "${a.homeFacility}" in Attendance on Demand.` });
    }
  }

  for (const [k, pList] of paycorByKey) {
    if (pList.length === 1 && pList[0].status === "active" && !aodByKey.has(k)) {
      issues.push({ type: "unmatched_paycor_active", severity: "low", key: k, paycorEmployeeId: pList[0].paycorEmployeeId, message: `${name(pList[0])} is active in Paycor but has no Attendance on Demand record.` });
    }
  }

  const cutoff = now.getTime() - recentDays * 86_400_000;
  const recentKeys = new Set(attendance.filter((r) => Date.parse(r.punchIn ?? r.workDate) >= cutoff).map((r) => norm(r.aodEmployeeKey)));
  for (const { key, employee } of matched) {
    if ((employee.status === "terminated" || employee.status === "inactive") && recentKeys.has(key)) {
      issues.push({ type: "inactive_with_recent_punches", severity: "high", key, paycorEmployeeId: employee.paycorEmployeeId, message: `${name(employee)} is ${employee.status} in Paycor but has punches in the last ${recentDays} days.` });
    }
  }

  return { matched, keyToEmployee, issues };
}

export { norm as normalizeKey };
