import crypto from "node:crypto";
import { employeeMatchField, getAodConfig, getPaycorConfig, missingAodSettings, missingPaycorSettings } from "../config";
import { assertCanWrite } from "../ownership";
import { matchEmployees } from "../reconciliation/matching";
import { mockSchedules } from "../schedules/mock";
import { readDb, writeDb } from "../store/db";
import type { Employee, IntegrationState } from "../store/types";
import { AodFileSource } from "./aod/file";
import { MockAodSource } from "./aod/mock";
import { AodSoapClient } from "./aod/soap";
import { IntegrationHttpError } from "./http";
import { connectedLegalEntities } from "./paycor/oauth";
import { PaycorClient } from "./paycor/client";
import { MockPaycorSource } from "./paycor/mock";
import type { AodSource, ConnectionTestResult, PaycorSource } from "./types";

type System = "paycor" | "aod";
const STALE_RUN_MS = 30 * 60 * 1000;

export function getPaycorSource(): PaycorSource {
  return getPaycorConfig().mode === "mock" ? new MockPaycorSource() : new PaycorClient();
}

export function getAodSource(): AodSource {
  const m = getAodConfig().mode;
  return m === "mock" ? new MockAodSource() : m === "file" ? new AodFileSource() : new AodSoapClient();
}

function patchState(system: System, patch: Partial<IntegrationState>) {
  writeDb((db) => {
    db.integrationState[system] = { ...db.integrationState[system], ...patch };
  });
}

function recordError(system: System, e: unknown) {
  const message = e instanceof IntegrationHttpError ? e.plainEnglish : (e as Error).message ?? String(e);
  const detail = e instanceof IntegrationHttpError ? e.bodySnippet : undefined;
  writeDb((db) => {
    db.syncErrors.unshift({ id: crypto.randomUUID(), system, at: new Date().toISOString(), message, detail, resolved: false });
    db.syncErrors = db.syncErrors.slice(0, 200);
  });
  return message;
}

export async function testConnection(system: System): Promise<ConnectionTestResult> {
  const missing = system === "paycor" ? missingPaycorSettings() : missingAodSettings();
  const result: ConnectionTestResult = missing.length
    ? { ok: false, message: `These settings are missing: ${missing.join(", ")}. See the setup guide.` }
    : await (system === "paycor" ? getPaycorSource() : getAodSource()).testConnection().catch((e: Error) => ({ ok: false, message: e.message }));
  patchState(system, { lastConnectionTestAt: new Date().toISOString(), lastConnectionTestOk: result.ok, lastConnectionTestMessage: result.message });
  return result;
}

async function guarded(system: System, fn: () => Promise<string>): Promise<{ ok: boolean; message: string }> {
  const st = readDb().integrationState[system];
  if (st.status === "running" && st.lastSyncStartedAt && Date.now() - Date.parse(st.lastSyncStartedAt) < STALE_RUN_MS) {
    return { ok: false, message: "A synchronization is already in progress." };
  }
  patchState(system, { status: "running", lastSyncStartedAt: new Date().toISOString() });
  try {
    const message = await fn();
    patchState(system, { status: "success", lastSuccessAt: new Date().toISOString() });
    return { ok: true, message };
  } catch (e) {
    const message = recordError(system, e);
    patchState(system, { status: "failed", lastFailureAt: new Date().toISOString(), lastFailureMessage: message });
    return { ok: false, message };
  }
}

const PAYCOR_FIELDS = ["paycorEmployeeId", "employeeNumber", "badgeNumber", "firstName", "lastName", "status", "hireDate", "terminationDate", "jobTitle", "department", "homeFacility", "legalEntityId"];

export function runPaycorSync() {
  return guarded("paycor", async () => {
    const missing = missingPaycorSettings();
    if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")}`);
    const source = getPaycorSource();
    const incoming = await source.fetchEmployees();
    const isMock = getPaycorConfig().mode === "mock";
    assertCanWrite("paycor", PAYCOR_FIELDS);
    const now = new Date().toISOString();
    let created = 0, updated = 0, skipped = 0;
    writeDb((db) => {
      // Never mix fake and real employees.
      db.employees = db.employees.filter((e) => e.isMock === isMock);
      for (const inc of incoming) {
        if (!inc.paycorEmployeeId) { skipped++; continue; }
        const existing = db.employees.find((e) => e.paycorEmployeeId === inc.paycorEmployeeId);
        if (existing) {
          // Update ONLY Paycor-owned fields; keep SNF Workforce-owned fields (regionalPool).
          Object.assign(existing, inc, { id: existing.id, regionalPool: existing.regionalPool, lastSyncedAt: now });
          updated++;
        } else {
          const e: Employee = { ...inc, id: crypto.randomUUID(), lastSyncedAt: now };
          db.employees.push(e);
          created++;
        }
      }
      if (isMock) db.schedules = mockSchedules(db.employees);
      else db.schedules = db.schedules.filter((s) => !s.id.startsWith("MOCK-"));
    });
    return `${source.label}: ${incoming.length} employees received (${created} new, ${updated} updated${skipped ? `, ${skipped} skipped with no Paycor ID` : ""}).`;
  });
}

export function runAodSync(days = 14) {
  return guarded("aod", async () => {
    const missing = missingAodSettings();
    if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")}`);
    const source = getAodSource();
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const [aodEmployees, records] = await Promise.all([source.fetchEmployees(), source.fetchAttendance(from, to)]);
    assertCanWrite("aod", ["punchIn", "punchOut", "hours", "approved"]);
    const isMock = getAodConfig().mode === "mock";
    const importedAt = new Date().toISOString();
    writeDb((db) => {
      // AOD employees are stored separately and used ONLY for matching.
      db.aodEmployees = aodEmployees;
      db.attendance = db.attendance.filter((a) => a.isMock === isMock);
      const byId = new Map(db.attendance.map((a) => [a.id, a]));
      for (const r of records) byId.set(r.id, { ...r, importedAt });
      db.attendance = [...byId.values()];
    });
    return `${source.label}: ${aodEmployees.length} AOD employees and ${records.length} attendance records imported for the last ${days} days.`;
  });
}

export type DisplayStatus = "connected" | "needs_attention" | "disconnected" | "syncing";

export interface IntegrationSummary {
  system: System;
  label: string;
  mode: string;
  status: DisplayStatus;
  statusReason: string;
  state: IntegrationState;
  missingSettings: string[];
  openErrors: number;
}

export function summarize(): { paycor: IntegrationSummary; aod: IntegrationSummary; counts: Record<string, number> } {
  const db = readDb();
  const pc = getPaycorConfig();
  const ac = getAodConfig();
  const open = (s: System) => db.syncErrors.filter((e) => e.system === s && !e.resolved).length;

  const compute = (system: System, missing: string[], notConnectedReason?: string): { status: DisplayStatus; reason: string } => {
    const st = db.integrationState[system];
    if (st.status === "running" && st.lastSyncStartedAt && Date.now() - Date.parse(st.lastSyncStartedAt) < STALE_RUN_MS) return { status: "syncing", reason: "Synchronization in progress." };
    if (missing.length) return { status: "disconnected", reason: `Missing settings: ${missing.join(", ")}` };
    if (notConnectedReason) return { status: "disconnected", reason: notConnectedReason };
    if (st.lastConnectionTestOk === false) return { status: "needs_attention", reason: st.lastConnectionTestMessage ?? "Last connection test failed." };
    if (st.status === "failed") return { status: "needs_attention", reason: st.lastFailureMessage ?? "Last synchronization failed." };
    if (open(system)) return { status: "needs_attention", reason: `${open(system)} unresolved error(s).` };
    if (st.lastSuccessAt || st.lastConnectionTestOk) return { status: "connected", reason: "Working normally." };
    return { status: "disconnected", reason: "Not tested yet. Click 'Test connection'." };
  };

  const pcMissing = missingPaycorSettings(pc);
  const pcNotConnected = pc.mode !== "mock" && !pcMissing.length && connectedLegalEntities(pc).length === 0 ? "Paycor has not been authorized yet. Click 'Connect Paycor'." : undefined;
  const p = compute("paycor", pcMissing, pcNotConnected);
  const acMissing = missingAodSettings(ac);
  const a = compute("aod", acMissing);

  const match = matchEmployees(db.employees, db.aodEmployees, db.attendance, employeeMatchField());
  return {
    paycor: { system: "paycor", label: "Paycor", mode: pc.mode, status: p.status, statusReason: p.reason, state: db.integrationState.paycor, missingSettings: pcMissing, openErrors: open("paycor") },
    aod: { system: "aod", label: "Attendance on Demand", mode: `${ac.mode}${ac.mode === "mock" ? "" : ` / ${ac.environment}`}`, status: a.status, statusReason: a.reason, state: db.integrationState.aod, missingSettings: acMissing, openErrors: open("aod") },
    counts: {
      employees: db.employees.length,
      attendance: db.attendance.length,
      matched: match.matched.length,
      unmatchedEmployees: match.issues.filter((i) => i.type === "unmatched_aod" || i.type === "missing_id_aod" || i.type === "missing_id_paycor").length,
      matchIssues: match.issues.length,
      pendingErrors: db.syncErrors.filter((e) => !e.resolved).length,
    },
  };
}

export function resolveError(id: string) {
  writeDb((db) => {
    const e = db.syncErrors.find((x) => x.id === id);
    if (e) e.resolved = true;
  });
}
