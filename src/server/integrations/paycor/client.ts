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
 * Verification status (developers.paycor.com guides, read 2026-11-25):
 *  - employeesByLegalEntity: path CONFIRMED (quoted verbatim in the paging guide).
 *  - legalEntity, employeePayRates: the portal lists "Get Legal Entity" and
 *    "Get Employee Payrates by EmployeeID", but the exact paths live in the API
 *    reference (served from api.paycor.com, not yet reachable). Still unconfirmed.
 * Paging is CONFIRMED: continuationToken query parameter, hasMoreResults, max 100 per page.
 * Rate limit is CONFIRMED: 1,000 calls/minute per app, counted across all APIs.
 */
export const PAYCOR_ENDPOINTS = {
  legalEntity: (le: string) => `/v1/legalentities/${le}`,
  employeesByLegalEntity: (le: string) => `/v1/legalentities/${le}/employees`,
  employeePayRates: (employeeId: string) => `/v1/employees/${employeeId}/payrates`,
} as const;

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

  private async get(path: string, le: string, query: Record<string, string> = {}): Promise<Json> {
    const token = await getAccessToken(this.db, this.orgId, le, this.c);
    const url = new URL(this.c.apiBaseUrl + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    await this.throttle();
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}`, [SUBSCRIPTION_KEY_HEADER]: this.c.subscriptionKey ?? "", Accept: "application/json" },
    });
    if (!res.ok) throw new IntegrationHttpError(res.status, explainHttpStatus("Paycor", res.status), redact(await res.text().catch(() => "")));
    return (await res.json()) as Json;
  }

  /** Follows Paycor-style paging (records + continuationToken / hasMoreResults). */
  private async getAll(path: string, le: string): Promise<Json[]> {
    const out: Json[] = [];
    let continuationToken: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      const body = await this.get(path, le, continuationToken ? { continuationToken } : {});
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
      const records = recordsOf(await this.get(PAYCOR_ENDPOINTS.employeesByLegalEntity(le), le));
      return {
        ok: true,
        message: `Success! Paycor answered for legal entity ${le} and returned employee data.`,
        details: { legalEntityId: le, connectedLegalEntities: les.length, employeesOnFirstPage: records.length, employeeFieldNames: records[0] ? Object.keys(records[0]).sort() : [] },
      };
    } catch (e) {
      return { ok: false, message: e instanceof IntegrationHttpError ? e.plainEnglish : (e as Error).message };
    }
  }

  async fetchEmployees() {
    const les = await this.legalEntities();
    if (!les.length) throw new Error("No Paycor legal entity is connected.");
    const records: PaycorEmployeeRecord[] = [];
    for (const le of les) for (const r of await this.getAll(PAYCOR_ENDPOINTS.employeesByLegalEntity(le), le)) records.push(mapPaycorEmployee(r, le));
    return { records, legalEntities: les };
  }

  /**
   * Pay rates (owner-approved). Off unless PAYCOR_IMPORT_PAY_RATES=true, because
   * the endpoint and the scope it needs must first be confirmed in the portal.
   * Takes the primary (first) current rate per employee.
   */
  async fetchPayRates(employees: PaycorEmployeeRecord[]): Promise<PaycorPayRate[]> {
    if (process.env.PAYCOR_IMPORT_PAY_RATES !== "true") return [];
    const out: PaycorPayRate[] = [];
    for (const e of employees.filter((x) => x.status !== "terminated" && x.paycorEmployeeId)) {
      const rows = await this.getAll(PAYCOR_ENDPOINTS.employeePayRates(e.paycorEmployeeId), e.legalEntityId);
      const current = rows.map((r) => mapPayRate(r, e.paycorEmployeeId)).find((x) => x);
      if (current) out.push(current);
    }
    return out;
  }
}

/** Hours used to convert an annual salary to an hourly equivalent (2,080 = 40h × 52). */
export const SALARY_HOURS_PER_YEAR = 2080;

/** Maps one Paycor pay-rate record. Field names are unverified; adjust after Test connection. */
export function mapPayRate(r: Json, paycorEmployeeId: string): PaycorPayRate | null {
  const typeRaw = (pick(r, "payType", "type", "rateType") ?? "hourly").toLowerCase();
  const amount = Number(pick(r, "payRate", "rate", "amount", "hourlyRate", "annualAmount"));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const salary = typeRaw.includes("salar") || amount > 500;
  return {
    paycorEmployeeId,
    payType: salary ? "salary" : "hourly",
    hourlyRate: Math.round((salary ? amount / SALARY_HOURS_PER_YEAR : amount) * 100) / 100,
    description: pick(r, "description", "payRateDescription", "name"),
    effectiveFrom: (pick(r, "effectiveDate", "effectiveStartDate", "startDate") ?? new Date().toISOString()).slice(0, 10),
  };
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

export function normalizeStatus(raw?: string): PaycorStatus {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("term")) return "terminated";
  if (s.includes("leave") || s.includes("loa")) return "leave";
  if (s.includes("inactive")) return "inactive";
  if (s.includes("active")) return "active";
  return "unknown";
}

/** Defensive mapping; adjust once real field names are confirmed via Test connection. */
export function mapPaycorEmployee(r: Json, legalEntityId: string): PaycorEmployeeRecord {
  return {
    paycorEmployeeId: pick(r, "id", "employeeId", "EmployeeId") ?? "",
    legalEntityId,
    employeeNumber: pick(r, "employeeNumber", "EmployeeNumber"),
    badgeNumber: pick(r, "badgeNumber", "timeClockNumber"),
    firstName: pick(r, "firstName", "FirstName", "name.firstName") ?? "",
    lastName: pick(r, "lastName", "LastName", "name.lastName") ?? "",
    preferredName: pick(r, "preferredName", "name.preferredName"),
    email: pick(r, "workEmail", "email", "emailAddresses.work", "contactData.workEmail"),
    mobilePhone: pick(r, "mobilePhone", "phones.mobile", "contactData.mobilePhone"),
    status: normalizeStatus(pick(r, "status", "employmentStatus", "statusData.status", "employmentDateData.status")),
    employmentClass: pick(r, "employmentType", "employeeType", "statusData.employeeType", "positionData.employmentType"),
    hireDate: pick(r, "hireDate", "employmentDateData.hireDate")?.slice(0, 10),
    terminationDate: pick(r, "terminationDate", "employmentDateData.terminationDate")?.slice(0, 10),
    position: pick(r, "jobTitle", "position.jobTitle", "positionData.jobTitle", "positionData.title"),
    department: pick(r, "department", "departmentName", "positionData.department", "positionData.departmentName"),
    location: pick(r, "location", "workLocation.name", "workLocation", "positionData.workLocation", "positionData.workLocationName"),
  };
}
