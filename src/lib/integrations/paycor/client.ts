/**
 * Live Paycor client (sandbox or production).
 *
 * Endpoint paths below come from Paycor's public API v1 as referenced in
 * Paycor's developer portal and third-party integration docs. They MUST be
 * confirmed in the portal's "Explore" API reference for this account, since
 * not every endpoint is enabled for every Paycor customer. Field mapping is
 * deliberately defensive; use "Test connection" to see which field NAMES
 * Paycor actually returns (no values / no PII are shown) and adjust mapping.
 */
import { getPaycorConfig, type PaycorConfig } from "../../config";
import type { EmploymentStatus } from "../../store/types";
import { explainHttpStatus, IntegrationHttpError, redact } from "../http";
import type { ConnectionTestResult, PaycorEmployeeInput, PaycorSource } from "../types";
import { connectedLegalEntities, getAccessToken, SUBSCRIPTION_KEY_HEADER } from "./oauth";

type Json = Record<string, unknown>;

export const PAYCOR_ENDPOINTS = {
  // Unverified until confirmed in the Paycor portal's API reference.
  legalEntity: (le: number) => `/v1/legalentities/${le}`,
  employeesByLegalEntity: (le: number) => `/v1/legalentities/${le}/employees`,
  employee: (id: string) => `/v1/employees/${id}`,
} as const;

export class PaycorClient implements PaycorSource {
  readonly label: string;
  constructor(private c: PaycorConfig = getPaycorConfig()) {
    this.label = c.mode === "production" ? "Paycor (PRODUCTION)" : "Paycor (sandbox)";
  }

  private legalEntities(): number[] {
    if (this.c.legalEntityIds.length) return this.c.legalEntityIds;
    return connectedLegalEntities(this.c).filter((x): x is number => x !== null);
  }

  async get(path: string, legalEntityId: number | null, query: Record<string, string> = {}): Promise<Json> {
    const token = await getAccessToken(legalEntityId, this.c);
    const url = new URL(this.c.apiBaseUrl + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        [SUBSCRIPTION_KEY_HEADER]: this.c.subscriptionKey ?? "",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new IntegrationHttpError(res.status, explainHttpStatus("Paycor", res.status), redact(text));
    }
    return (await res.json()) as Json;
  }

  /** Follows Paycor-style paging (records + continuationToken / hasMoreResults). */
  private async getAll(path: string, le: number): Promise<Json[]> {
    const out: Json[] = [];
    let continuationToken: string | undefined;
    for (let page = 0; page < 500; page++) {
      const body = await this.get(path, le, continuationToken ? { continuationToken } : {});
      const records = (Array.isArray(body) ? body : (body.records ?? body.Records ?? body.data ?? [])) as Json[];
      out.push(...records);
      const more = body.hasMoreResults ?? body.HasMoreResults;
      continuationToken = (body.continuationToken ?? body.ContinuationToken) as string | undefined;
      if (!more || !continuationToken) break;
    }
    return out;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const les = this.legalEntities();
    if (!les.length) {
      return {
        ok: false,
        message:
          "Connected to Paycor is not yet possible: no legal entity is known. Either set PAYCOR_LEGAL_ENTITY_IDS or complete 'Connect Paycor' for a legal entity.",
      };
    }
    const le = les[0];
    try {
      await this.get(PAYCOR_ENDPOINTS.legalEntity(le), le);
      const employees = await this.get(PAYCOR_ENDPOINTS.employeesByLegalEntity(le), le);
      const records = (Array.isArray(employees) ? employees : (employees.records ?? [])) as Json[];
      return {
        ok: true,
        message: `Success! Paycor answered for legal entity ${le} and returned employee data.`,
        details: {
          legalEntityId: le,
          employeesOnFirstPage: records.length,
          // Field NAMES only (no values) so we can verify the mapping safely.
          employeeFieldNames: records[0] ? Object.keys(records[0]).sort() : [],
        },
      };
    } catch (e) {
      return { ok: false, message: e instanceof IntegrationHttpError ? e.plainEnglish : String((e as Error).message) };
    }
  }

  async fetchEmployees(): Promise<PaycorEmployeeInput[]> {
    const out: PaycorEmployeeInput[] = [];
    for (const le of this.legalEntities()) {
      const rows = await this.getAll(PAYCOR_ENDPOINTS.employeesByLegalEntity(le), le);
      for (const r of rows) out.push(mapPaycorEmployee(r, le));
    }
    return out;
  }
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  return String(v);
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

export function normalizeStatus(raw?: string): EmploymentStatus {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("term")) return "terminated";
  if (s.includes("leave") || s.includes("loa")) return "leave";
  if (s.includes("inactive")) return "inactive";
  if (s.includes("active")) return "active";
  return "unknown";
}

/** Defensive mapping - adjust once real field names are confirmed. */
export function mapPaycorEmployee(r: Json, legalEntityId: number): PaycorEmployeeInput {
  return {
    paycorEmployeeId: pick(r, "id", "employeeId", "EmployeeId") ?? "",
    employeeNumber: pick(r, "employeeNumber", "EmployeeNumber"),
    badgeNumber: pick(r, "badgeNumber", "timeClockNumber"),
    firstName: pick(r, "firstName", "FirstName", "name.firstName") ?? "",
    lastName: pick(r, "lastName", "LastName", "name.lastName") ?? "",
    status: normalizeStatus(pick(r, "status", "employmentStatus", "statusData.status", "employmentDateData.status")),
    hireDate: pick(r, "hireDate", "employmentDateData.hireDate"),
    terminationDate: pick(r, "terminationDate", "employmentDateData.terminationDate"),
    jobTitle: pick(r, "jobTitle", "position.jobTitle", "positionData.jobTitle"),
    department: pick(r, "department", "departmentName", "positionData.department"),
    homeFacility: pick(r, "location", "workLocation.name", "workLocation", "positionData.workLocation"),
    legalEntityId,
    isMock: false,
  };
}
