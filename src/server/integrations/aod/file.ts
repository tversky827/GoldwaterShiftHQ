/**
 * Attendance on Demand scheduled-export importer (AOD_MODE=file).
 *
 * AOD can typically produce scheduled exports; the exact columns depend on
 * how your AOD export is configured. We recognise common header names
 * (case-insensitive) and report any file we can't understand rather than
 * guessing. Once AOD sends a sample export, add its exact headers below.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAodConfig, type AodConfig } from "../config";
import type { AodEmployee, AttendanceRecord } from "./types";
import type { AodSource, ConnectionTestResult } from "./types";
import { parseCsv } from "./csv";

export const HEADER_ALIASES = {
  employeeKey: ["employee number", "employee #", "emp #", "empnum", "employee id", "id num", "idnum", "file number", "badge", "badge number"],
  firstName: ["first name", "firstname"],
  lastName: ["last name", "lastname"],
  facility: ["facility", "location", "home location", "workgroup", "department", "site"],
  workDate: ["date", "work date", "punch date", "shift date"],
  punchIn: ["in", "punch in", "time in", "in punch", "clock in"],
  punchOut: ["out", "punch out", "time out", "out punch", "clock out"],
  hours: ["hours", "total hours", "worked hours", "reg+ot hours"],
  approved: ["approved", "is approved", "supervisor approved"],
  active: ["active", "status", "employee status"],
} as const;

type Col = keyof typeof HEADER_ALIASES;

export function mapHeaders(headers: string[]): { map: Partial<Record<Col, number>>; unknown: string[] } {
  const map: Partial<Record<Col, number>> = {};
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    const norm = h.trim().toLowerCase();
    const col = (Object.keys(HEADER_ALIASES) as Col[]).find((k) => (HEADER_ALIASES[k] as readonly string[]).includes(norm));
    if (col && map[col] === undefined) map[col] = i;
    else if (!col) unknown.push(h);
  });
  return { map, unknown };
}

function toIso(date: string, time?: string): string | undefined {
  if (!time) return undefined;
  const t = time.trim();
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return new Date(t).toISOString();
  const d = new Date(`${date} ${t}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toYmd(date: string): string {
  const d = new Date(date.includes("T") || date.includes("-") ? date : `${date} 00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ParsedExport {
  attendance: AttendanceRecord[];
  employees: AodEmployee[];
  problems: string[];
}

export function parseAodExport(csvText: string, fileName = "upload.csv"): ParsedExport {
  const rows = parseCsv(csvText);
  const problems: string[] = [];
  if (rows.length < 2) return { attendance: [], employees: [], problems: [`${fileName}: file is empty.`] };
  const { map, unknown } = mapHeaders(rows[0]);
  if (map.employeeKey === undefined) {
    problems.push(`${fileName}: no employee number/badge column found. Headers seen: ${rows[0].join(", ")}`);
    return { attendance: [], employees: [], problems };
  }
  if (unknown.length) problems.push(`${fileName}: ignored unrecognised columns: ${unknown.join(", ")}`);
  const get = (r: string[], c: Col) => (map[c] !== undefined ? r[map[c]!]?.trim() : undefined);

  const attendance: ParsedExport["attendance"] = [];
  const employees = new Map<string, AodEmployee>();
  rows.slice(1).forEach((r, i) => {
    const key = get(r, "employeeKey") ?? "";
    const first = get(r, "firstName") ?? "";
    const last = get(r, "lastName") ?? "";
    const activeRaw = (get(r, "active") ?? "").toLowerCase();
    const empKey = key || `__missing__${first}|${last}`;
    if (!employees.has(empKey)) {
      employees.set(empKey, {
        aodId: key || `row-${i + 2}`,
        employeeNumber: key || undefined,
        firstName: first,
        lastName: last,
        active: !(activeRaw.startsWith("inactive") || activeRaw.startsWith("term") || activeRaw === "n" || activeRaw === "false"),
        homeFacility: get(r, "facility"),
        isMock: false,
      });
    }
    const dateRaw = get(r, "workDate");
    if (!dateRaw) return; // employee-only export row
    const workDate = toYmd(dateRaw);
    const rec = {
      aodEmployeeKey: key,
      facility: get(r, "facility"),
      workDate,
      punchIn: toIso(dateRaw, get(r, "punchIn")),
      punchOut: toIso(dateRaw, get(r, "punchOut")),
      hours: get(r, "hours") ? Number(get(r, "hours")) : undefined,
      approved: get(r, "approved") ? /^(y|yes|true|1)$/i.test(get(r, "approved")!) : undefined,
      isMock: false,
    };
    // Handle overnight shifts: out earlier than in => next day.
    if (rec.punchIn && rec.punchOut && rec.punchOut < rec.punchIn) {
      rec.punchOut = new Date(Date.parse(rec.punchOut) + 86400000).toISOString();
    }
    const id = crypto.createHash("sha256").update(JSON.stringify([rec.aodEmployeeKey, rec.workDate, rec.punchIn, rec.punchOut, rec.facility])).digest("hex").slice(0, 24);
    attendance.push({ id, ...rec });
  });
  return { attendance, employees: [...employees.values()], problems };
}

export class AodFileSource implements AodSource {
  readonly label = "Attendance on Demand (scheduled export files)";
  readonly isDemo = false;
  constructor(private c: AodConfig = getAodConfig()) {}

  private files(): string[] {
    if (!fs.existsSync(this.c.exportDir)) return [];
    return fs.readdirSync(this.c.exportDir).filter((f) => f.toLowerCase().endsWith(".csv")).map((f) => path.join(this.c.exportDir, f));
  }

  private parseAll(): ParsedExport {
    const all: ParsedExport = { attendance: [], employees: [], problems: [] };
    for (const f of this.files()) {
      const p = parseAodExport(fs.readFileSync(f, "utf8"), path.basename(f));
      all.attendance.push(...p.attendance);
      all.employees.push(...p.employees);
      all.problems.push(...p.problems);
    }
    return all;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const files = this.files();
    if (!files.length) return { ok: false, message: `No .csv export files found in ${this.c.exportDir}. Upload one on the dashboard or place AOD's export there.` };
    const p = this.parseAll();
    return {
      ok: p.attendance.length > 0 || p.employees.length > 0,
      message: `Read ${files.length} export file(s): ${p.employees.length} employees, ${p.attendance.length} attendance rows.`,
      details: { problems: p.problems },
    };
  }
  async fetchEmployees() {
    return this.parseAll().employees;
  }
  async fetchAttendance(from: Date, to: Date) {
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    return this.parseAll().attendance.filter((a) => a.workDate >= f && a.workDate <= t);
  }
}
