/**
 * Live Paycor client (sandbox or production). Server-side only.
 *
 * Endpoint paths come from Paycor's public API v1 as referenced in Paycor's
 * developer portal and third-party integration docs. They MUST be confirmed in
 * the portal's API reference (https://developers.paycor.com/explore) for this
 * account; not every endpoint is enabled for every customer. Field mapping is
 * defensive. "Test connection" reports the field NAMES Paycor returns (never
 * values) so the mapping can be verified safely.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { getPaycorConfig, type PaycorConfig } from "../config";
import { createThrottle, explainHttpStatus, fetchWithRetry, IntegrationHttpError, redact } from "../http";
import { getAccessToken, SUBSCRIPTION_KEY_HEADER } from "./oauth";
import type { ConnectionTestResult, PaycorEmployeeRecord, PaycorPayRate, PaycorSource, PaycorStatus } from "./types";

type Json = Record<string, unknown>;

/**
 * VERIFIED against Paycor's published OpenAPI specification ("Paycor Public
 * API v1", embedded in developers.paycor.com, read 2026-11-25).
 * Each endpoint needs the matching AppCreator "Data Access" item, listed below.
 */
export const PAYCOR_ENDPOINTS = {
  /** Data Access: View Legal Entity Basic Information */
  legalEntity: (le: string) => `/v1/legalentities/${le}`,
  /**
   * Data Access: View Legal Entity Employees, plus (for the `include` options)
   * ...Employment Dates, ...Status, ...Position, ...Work Location.
   */
  employeesByLegalEntity: (le: string) => `/v1/legalentities/${le}/employees`,
  /** Data Access: View Legal Entity Departments Information */
  departments: (le: string) => `/v1/legalentities/${le}/departments`,
  /** Data Access: View Legal Entity Payrates (one call per legal entity, not per employee). */
  payRatesByLegalEntity: (le: string) => `/v1/legalentities/${le}/payrates`,
  /** Data Access: View Employee Payrates (kept for reference; the bulk endpoint is used). */
  employeePayRates: (employeeId: string) => `/v1/employees/${employeeId}/payrates`,
} as const;

/**
 * Without `include`, Paycor returns only names and IDs: no status, dates, job
 * title or work location. Sent as repeated parameters (style=form, explode=true).
 */
export const EMPLOYEE_INCLUDE = ["EmploymentDates", "Status", "Position", "WorkLocation"] as const;

export class PaycorClient implements PaycorSource {
  readonly label: string;
  readonly isDemo = false;
  private throttle: () => Promise<void>;

  constructor(
    private db: Db,
    private orgId: string,
    private c: PaycorConfig = getPaycorConfig(),
  ) {
    this.label = c.mode === "production" ? "Paycor (production)" : "Paycor (sandbox)";
    this.throttle = createThrottle(c.minRequestIntervalMs);
  }

  async legalEntities(): Promise<string[]> {
    const env = this.c.mode === "production" ? "production" : "sandbox";
    const rows = await this.db
      .select({ le: integrationConnections.legalEntityId })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, this.orgId),
          eq(integrationConnections.provider, "paycor"),
          eq(integrationConnections.environment, env),
          eq(integrationConnections.isEnabled, true),
          isNotNull(integrationConnections.refreshTokenEnc),
        ),
      );
    return rows.map((r) => r.le).filter((x): x is string => !!x);
  }

  private async get(path: string, le: string, query: Record<string, string | readonly string[]> = {}): Promise<Json> {
    const token = await getAccessToken(this.db, this.orgId, le, this.c);
    const url = new URL(this.c.apiBaseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (typeof v === "string") url.searchParams.set(k, v);
      else for (const x of v) url.searchParams.append(k, x);
    }
    await this.throttle();
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}`, [SUBSCRIPTION_KEY_HEADER]: this.c.subscriptionKey ?? "", Accept: "application/json" },
    });
    if (!res.ok) throw new IntegrationHttpError(res.status, explainHttpStatus("Paycor", res.status), redact(await res.text().catch(() => "")));
    return (await res.json()) as Json;
  }

  /** Follows Paycor paging (records + continuationToken / hasMoreResults; max 100 per page). */
  private async getAll(path: string, le: string, query: Record<string, string | readonly string[]> = {}): Promise<Json[]> {
    const out: Json[] = [];
    let continuationToken: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      const body = await this.get(path, le, continuationToken ? { ...query, continuationToken } : query);
      out.push(...recordsOf(body));
      const more = body.hasMoreResults ?? body.HasMoreResults;
      continuationToken = (body.continuationToken ?? body.ContinuationToken) as string | undefined;
      if (!more || !continuationToken || seen.has(continuationToken)) break;
      seen.add(continuationToken);
    }
    return out;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const les = await this.legalEntities();
    if (!les.length) return { ok: false, message: "No legal entity is connected yet. Use “Connect Paycor” and enter a legal entity ID." };
    const le = les[0];
    try {
      await this.get(PAYCOR_ENDPOINTS.legalEntity(le), le);
      const records = recordsOf(await this.get(PAYCOR_ENDPOINTS.employeesByLegalEntity(le), le, { include: EMPLOYEE_INCLUDE }));
      const first = records[0];
      // Which optional sections came back tells us which Data Access items are enabled.
      const sections = first ? { status: !!first.statusData, employmentDates: !!first.employmentDateData, position: !!first.positionData, workLocation: !!first.workLocation } : {};
      return {
        ok: true,
        message: `Success! Paycor answered for legal entity ${le} and returned employee data.`,
        details: { legalEntityId: le, connectedLegalEntities: les.length, employeesOnFirstPage: records.length, employeeFieldNames: first ? Object.keys(first).sort() : [], sectionsReturned: sections },
      };
    } catch (e) {
      return { ok: false, message: e instanceof IntegrationHttpError ? e.plainEnglish : (e as Error).message };
    }
  }

  async fetchEmployees() {
    const les = await this.legalEntities();
    if (!les.length) throw new Error("No Paycor legal entity is connected.");
    const records: PaycorEmployeeRecord[] = [];
    for (const le of les) {
      // Employees carry only a department ID; names come from the department list.
      let deptNames = new Map<string, string>();
      try {
        deptNames = departmentNames(await this.getAll(PAYCOR_ENDPOINTS.departments(le), le));
      } catch (e) {
        // Missing "View Legal Entity Departments Information": continue without department names.
        if (!(e instanceof IntegrationHttpError && e.status === 403)) throw e;
      }
      for (const r of await this.getAll(PAYCOR_ENDPOINTS.employeesByLegalEntity(le), le, { include: EMPLOYEE_INCLUDE })) records.push(mapPaycorEmployee(r, le, deptNames));
    }
    return { records, legalEntities: les };
  }

  /**
   * Pay rates (owner-approved, decision A1). Off unless PAYCOR_IMPORT_PAY_RATES=true
   * (needs Data Access "View Legal Entity Payrates"). One paged call per legal
   * entity with includeCurrentOnly=true; the primary rate (lowest sequence
   * number) is kept per employee.
   */
  async fetchPayRates(employees: PaycorEmployeeRecord[]): Promise<PaycorPayRate[]> {
    if (process.env.PAYCOR_IMPORT_PAY_RATES !== "true") return [];
    const wanted = new Set(employees.filter((x) => x.status !== "terminated" && x.paycorEmployeeId).map((x) => x.paycorEmployeeId));
    const best = new Map<string, { seq: number; rate: PaycorPayRate }>();
    for (const le of [...new Set(employees.map((e) => e.legalEntityId))]) {
      for (const r of await this.getAll(PAYCOR_ENDPOINTS.payRatesByLegalEntity(le), le, { includeCurrentOnly: "true" })) {
        const id = pick(r, "employee.id", "employees.id");
        if (!id || !wanted.has(id)) continue;
        const rate = mapPayRate(r, id);
        if (!rate) continue;
        const seq = Number(r.sequenceNumber ?? 999);
        const cur = best.get(id);
        if (!cur || seq < cur.seq) best.set(id, { seq, rate });
      }
    }
    return [...best.values()].map((b) => b.rate);
  }
}

/** Hours used to convert an annual salary to an hourly equivalent (2,080 = 40h × 52). */
export const SALARY_HOURS_PER_YEAR = 2080;

/**
 * Maps one Paycor pay-rate record (EmployeePayRate / LegalEntityPayRate):
 * type is Salary | Hourly | Unpaid; payRate is the rate; annualPayRate is the
 * annual amount. Salaried rates are converted at 2,080 hours (decision A1).
 */
export function mapPayRate(r: Json, paycorEmployeeId: string): PaycorPayRate | null {
  const type = (pick(r, "type") ?? "").toLowerCase();
  if (type === "unpaid") return null;
  const end = pick(r, "effectiveEndDate");
  if (end && end.slice(0, 10) < new Date().toISOString().slice(0, 10)) return null;
  const salary = type === "salary";
  const amount = salary ? Number(pick(r, "annualPayRate") ?? NaN) : Number(pick(r, "payRate") ?? NaN);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    paycorEmployeeId,
    payType: salary ? "salary" : "hourly",
    hourlyRate: Math.round((salary ? amount / SALARY_HOURS_PER_YEAR : amount) * 100) / 100,
    description: pick(r, "description"),
    effectiveFrom: (pick(r, "effectiveStartDate") ?? new Date().toISOString()).slice(0, 10),
  };
}

/** Department id -> name (description, else code). */
export function departmentNames(rows: Json[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of rows) {
    const id = pick(d, "id");
    const name = pick(d, "description", "code");
    if (id && name) m.set(id, name);
  }
  return m;
}

function recordsOf(body: Json): Json[] {
  return (Array.isArray(body) ? body : (body.records ?? body.Records ?? body.data ?? [])) as Json[];
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  return String(v).trim() || undefined;
}
function pick(o: Json, ...paths: string[]): string | undefined {
  for (const p of paths) {
    let cur: unknown = o;
    for (const k of p.split(".")) cur = cur && typeof cur === "object" ? (cur as Json)[k] : undefined;
    const s = str(cur);
    if (s) return s;
  }
  return undefined;
}

/**
 * Paycor EmploymentStatus values (from the API specification): Active,
 * Deceased, LongTermDisability, ShortTermDisability, Fmla, LaidOff,
 * LeaveWithPay, LeaveWithoutPay, ThirdPartyPayable, Resigned, Retired,
 * Terminated, WorkersCompensation.
 */
export function normalizeStatus(raw?: string): PaycorStatus {
  const s = (raw ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!s) return "unknown";
  // Leaves first: "ShortTermDisability" contains "term" but is not a termination.
  if (["fmla", "leavewithpay", "leavewithoutpay", "shorttermdisability", "longtermdisability", "workerscompensation", "thirdpartypayable"].includes(s) || s.includes("leave") || s.includes("loa") || s.includes("disability")) return "leave";
  if (["terminated", "resigned", "retired", "deceased"].includes(s) || s.includes("terminat")) return "terminated";
  if (s === "laidoff" || s.includes("inactive")) return "inactive";
  if (s === "active" || s.includes("active")) return "active";
  return "unknown";
}

/**
 * Paycor has no single "Full Time / Part Time / PRN" field. It sends
 * statusData.isFullTime plus statusData.type (Regular, Variable, Casual,
 * Seasonal, Temporary, IndependentContractor). This turns them into one
 * readable label that the sync classifies. "Casual" is treated as PRN; the
 * owner should confirm that matches how Goldwater uses it in Paycor.
 */
export function employmentClassOf(r: Json): string | undefined {
  const sd = (r.statusData ?? {}) as Json;
  const type = str(sd.type);
  const full = sd.isFullTime;
  if (type && /temporary|seasonal/i.test(type)) return `Temporary (${type})`;
  if (type && /casual/i.test(type)) return "PRN (Casual)";
  if (full === true) return `Full Time${type ? ` (${type})` : ""}`;
  if (full === false) return `Part Time${type ? ` (${type})` : ""}`;
  return pick(r, "employmentType", "employeeType") ?? type;
}

/** Maps one EmployeeReturnItem (field names verified in Paycor's API specification). */
export function mapPaycorEmployee(r: Json, legalEntityId: string, deptNames: Map<string, string> = new Map()): PaycorEmployeeRecord {
  const deptId = pick(r, "department.id");
  return {
    paycorEmployeeId: pick(r, "id") ?? "",
    legalEntityId,
    employeeNumber: pick(r, "employeeNumber"),
    badgeNumber: pick(r, "badgeNumber"),
    firstName: pick(r, "firstName") ?? "",
    lastName: pick(r, "lastName") ?? "",
    preferredName: pick(r, "preferredName"),
    email: pick(r, "email.emailAddress", "workEmail"),
    // Not part of the employees list; Paycor keeps phones on the person record.
    mobilePhone: pick(r, "mobilePhone"),
    status: normalizeStatus(pick(r, "statusData.status", "status")),
    employmentClass: employmentClassOf(r),
    hireDate: pick(r, "employmentDateData.hireDate")?.slice(0, 10),
    terminationDate: pick(r, "employmentDateData.terminationDate")?.slice(0, 10),
    position: pick(r, "positionData.jobTitle", "positionData.jobCode"),
    department: (deptId && deptNames.get(deptId)) || pick(r, "department.name") || undefined,
    location: pick(r, "workLocation.name"),
  };
}
