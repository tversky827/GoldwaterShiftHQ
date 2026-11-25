/**
 * Paycor → SNF Workforce employee synchronization.
 *
 * Safety properties
 *  - Fetch-then-apply: every record is downloaded first; if Paycor fails
 *    mid-way, NOTHING is written (integration outages can't corrupt data).
 *  - Single transaction: the whole apply step commits or rolls back.
 *  - Idempotent: re-running with the same data changes nothing.
 *  - Only Paycor-owned fields are written (ownership guard); SNF Workforce
 *    fields like regional pool classification are never touched.
 *  - Employees missing from the feed are NOT deactivated (a partial feed must
 *    never mass-deactivate staff). Only an explicit Paycor status change does.
 *  - Deactivation preserves history; pending claims and waitlists are
 *    cancelled so the employee can't pick up new shifts.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import {
  departments,
  employeePositions,
  employees,
  integrationConnections,
  integrationFieldMappings,
  integrationSyncLogs,
  positions,
  shiftAssignments,
  shiftClaims,
  shiftWaitlists,
} from "@/db/schema";
import { audit, diff, type AuditContext } from "../../audit";
import { log } from "../../log";
import { getPaycorConfig, missingPaycorSettings } from "../config";
import { IntegrationHttpError } from "../http";
import { assertCanWrite } from "../ownership";
import type { PaycorEmployeeRecord, PaycorSource } from "./types";

const STALE_RUN_MS = 30 * 60 * 1000;

export function normalizeEmploymentType(raw?: string): "full_time" | "part_time" | "prn" | "temporary" | "unknown" {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("prn") || s.includes("per diem") || s.includes("perdiem") || s.includes("as needed")) return "prn";
  if (s.includes("part")) return "part_time";
  if (s.includes("full")) return "full_time";
  if (s.includes("temp") || s.includes("seasonal")) return "temporary";
  return "unknown";
}

export interface SyncOutcome {
  ok: boolean;
  syncLogId?: string;
  message: string;
  counts?: { received: number; created: number; updated: number; unchanged: number; deactivated: number; skipped: number; errors: number };
}

interface Lookups {
  locationToFacility: Map<string, string>;
  departmentMap: Map<string, string>; // `${facilityId}|${raw}` or `*|${raw}` -> departmentId
  deptByFacilityName: Map<string, string>; // `${facilityId}|${name}` -> departmentId
  positionMap: Map<string, string>; // raw lower -> positionId
}

async function loadLookups(db: Db | Tx, orgId: string): Promise<Lookups> {
  const maps = await db.select().from(integrationFieldMappings).where(and(eq(integrationFieldMappings.organizationId, orgId), eq(integrationFieldMappings.provider, "paycor")));
  const depts = await db.select({ id: departments.id, facilityId: departments.facilityId, name: departments.name }).from(departments);
  const pos = await db.select().from(positions).where(eq(positions.organizationId, orgId));
  const l: Lookups = { locationToFacility: new Map(), departmentMap: new Map(), deptByFacilityName: new Map(), positionMap: new Map() };
  for (const d of depts) l.deptByFacilityName.set(`${d.facilityId}|${d.name.toLowerCase()}`, d.id);
  for (const p of pos) {
    l.positionMap.set(p.name.toLowerCase(), p.id);
    l.positionMap.set(p.code.toLowerCase(), p.id);
  }
  for (const m of maps) {
    const key = m.sourceValue.toLowerCase();
    if (m.sourceType === "location" && m.facilityId) l.locationToFacility.set(key, m.facilityId);
    if (m.sourceType === "department" && m.departmentId) l.departmentMap.set(`${m.facilityId ?? "*"}|${key}`, m.departmentId);
    if (m.sourceType === "position" && m.positionId) l.positionMap.set(key, m.positionId);
  }
  return l;
}

const PAYCOR_FIELDS = [
  "paycorEmployeeId", "paycorLegalEntityId", "employeeNumber", "badgeNumber", "firstName", "lastName", "preferredName", "email", "mobilePhone",
  "employmentStatus", "employmentType", "paycorEmploymentClass", "hireDate", "terminationDate", "paycorPosition", "homeFacilityId", "homeDepartmentId",
  "paycorLocation", "paycorDepartment",
];

/** Run a Paycor employee sync. Never throws for vendor/data problems; returns an outcome and logs history. */
export async function syncPaycorEmployees(
  db: Db,
  opts: { organizationId: string; source: PaycorSource; trigger: "manual" | "scheduled" | "system"; actorUserId?: string | null; ctx?: AuditContext },
): Promise<SyncOutcome> {
  const cfg = getPaycorConfig();
  const environment = opts.source.isDemo ? "mock" : cfg.environment;
  const orgId = opts.organizationId;

  const [running] = await db
    .select({ id: integrationSyncLogs.id })
    .from(integrationSyncLogs)
    .where(
      and(
        eq(integrationSyncLogs.organizationId, orgId),
        eq(integrationSyncLogs.provider, "paycor"),
        eq(integrationSyncLogs.status, "running"),
        gt(integrationSyncLogs.startedAt, new Date(Date.now() - STALE_RUN_MS)),
      ),
    );
  if (running) return { ok: false, message: "A Paycor synchronization is already in progress." };

  const [logRow] = await db
    .insert(integrationSyncLogs)
    .values({ organizationId: orgId, provider: "paycor", environment, syncType: "employees", trigger: opts.trigger, initiatedBy: opts.actorUserId ?? null })
    .returning();

  const fail = async (message: string, detail?: string): Promise<SyncOutcome> => {
    await db
      .update(integrationSyncLogs)
      .set({ status: "failed", finishedAt: new Date(), errorCount: 1, errorSummary: message, details: detail ? { detail } : null })
      .where(eq(integrationSyncLogs.id, logRow.id));
    await touchConnections(db, orgId, environment, { lastFailureAt: new Date(), lastError: message, status: "needs_attention" }, opts.source.isDemo);
    log.warn("paycor.sync_failed", { syncLogId: logRow.id, message });
    return { ok: false, syncLogId: logRow.id, message };
  };

  if (!opts.source.isDemo) {
    const missing = missingPaycorSettings(cfg);
    if (missing.length) return fail(`Missing settings: ${missing.join(", ")}`);
  }

  // 1. FETCH everything first. Nothing is written if this fails.
  let records: PaycorEmployeeRecord[];
  try {
    records = (await opts.source.fetchEmployees()).records;
  } catch (e) {
    return fail(e instanceof IntegrationHttpError ? e.plainEnglish : (e as Error).message, e instanceof IntegrationHttpError ? e.bodySnippet : undefined);
  }

  // 2. APPLY in one transaction.
  assertCanWrite("paycor", PAYCOR_FIELDS);
  const ctx: AuditContext = { ...(opts.ctx ?? { organizationId: orgId }), organizationId: orgId, actorType: "integration", actorUserId: opts.actorUserId ?? null };
  const counts = { received: records.length, created: 0, updated: 0, unchanged: 0, deactivated: 0, skipped: 0, errors: 0 };
  const problems: string[] = [];
  const unmapped = { locations: {} as Record<string, number>, positions: {} as Record<string, number>, departments: {} as Record<string, number> };
  const bump = (m: Record<string, number>, k?: string) => k && (m[k] = (m[k] ?? 0) + 1);
  const futureAssignmentsFlagged: string[] = [];

  try {
    await db.transaction(async (tx) => {
      const l = await loadLookups(tx, orgId);
      const existingRows = await tx.select().from(employees).where(and(eq(employees.organizationId, orgId), sql`${employees.paycorEmployeeId} is not null`));
      const existing = new Map(existingRows.map((e) => [e.paycorEmployeeId!, e]));
      const seen = new Set<string>();
      const now = new Date();

      for (const r of records) {
        if (!r.paycorEmployeeId || !r.firstName || !r.lastName) {
          counts.skipped++;
          counts.errors++;
          problems.push(`Skipped a record with no Paycor ID or name (employee number ${r.employeeNumber ?? "unknown"}).`);
          continue;
        }
        if (seen.has(r.paycorEmployeeId)) {
          counts.skipped++;
          counts.errors++;
          problems.push(`Paycor sent employee ${r.paycorEmployeeId} twice; the second copy was ignored.`);
          continue;
        }
        seen.add(r.paycorEmployeeId);
        const prev = existing.get(r.paycorEmployeeId);

        const mappedFacility = r.location ? l.locationToFacility.get(r.location.toLowerCase()) : undefined;
        if (r.location && !mappedFacility) bump(unmapped.locations, r.location);
        const homeFacilityId = mappedFacility ?? prev?.homeFacilityId ?? null;
        let homeDepartmentId: string | null = prev?.homeDepartmentId ?? null;
        if (r.department && homeFacilityId) {
          const k = r.department.toLowerCase();
          homeDepartmentId = l.departmentMap.get(`${homeFacilityId}|${k}`) ?? l.departmentMap.get(`*|${k}`) ?? l.deptByFacilityName.get(`${homeFacilityId}|${k}`) ?? null;
          if (!homeDepartmentId) bump(unmapped.departments, r.department);
        }
        const positionId = r.position ? l.positionMap.get(r.position.toLowerCase()) : undefined;
        if (r.position && !positionId) bump(unmapped.positions, r.position);

        const status = r.status === "unknown" ? (prev?.employmentStatus ?? "inactive") : r.status;
        if (r.status === "unknown") problems.push(`Paycor status for employee ${r.employeeNumber ?? r.paycorEmployeeId} was not recognized; ${prev ? "kept the existing status" : "imported as inactive"}.`);

        const desired = {
          paycorLegalEntityId: r.legalEntityId,
          employeeNumber: r.employeeNumber ?? null,
          badgeNumber: r.badgeNumber ?? null,
          firstName: r.firstName,
          lastName: r.lastName,
          preferredName: r.preferredName ?? null,
          email: r.email ?? null,
          mobilePhone: r.mobilePhone ?? null,
          employmentStatus: status,
          employmentType: normalizeEmploymentType(r.employmentClass),
          paycorEmploymentClass: r.employmentClass ?? null,
          hireDate: r.hireDate ?? null,
          terminationDate: r.terminationDate ?? null,
          paycorPosition: r.position ?? null,
          paycorDepartment: r.department ?? null,
          paycorLocation: r.location ?? null,
          homeFacilityId,
          homeDepartmentId,
        };

        let employeeId: string;
        if (!prev) {
          const [created] = await tx
            .insert(employees)
            .values({ ...desired, organizationId: orgId, paycorEmployeeId: r.paycorEmployeeId, source: opts.source.isDemo ? "demo" : "paycor", isDemo: opts.source.isDemo, lastSyncedAt: now, statusChangedAt: now })
            .returning({ id: employees.id });
          employeeId = created.id;
          counts.created++;
          await audit(tx, ctx, { action: "employee.imported", entityType: "employee", entityId: employeeId, facilityId: homeFacilityId, after: { paycorEmployeeId: r.paycorEmployeeId, employeeNumber: desired.employeeNumber, employmentStatus: status } });
        } else {
          employeeId = prev.id;
          const d = diff(prev as unknown as Record<string, unknown>, desired);
          if (!d) counts.unchanged++;
          else {
            const statusChanged = prev.employmentStatus !== status;
            await tx
              .update(employees)
              .set({ ...desired, lastSyncedAt: now, ...(statusChanged ? { statusChangedAt: now } : {}) })
              .where(eq(employees.id, prev.id));
            counts.updated++;
            await audit(tx, ctx, { action: "employee.updated_from_paycor", entityType: "employee", entityId: prev.id, facilityId: homeFacilityId, ...d });
            if (statusChanged && (status === "inactive" || status === "terminated")) {
              counts.deactivated++;
              const future = await deactivateEmployee(tx, ctx, prev.id, homeFacilityId, status);
              if (future > 0) futureAssignmentsFlagged.push(prev.id);
            } else if (statusChanged && status === "active") {
              await audit(tx, ctx, { action: "employee.reactivated", entityType: "employee", entityId: prev.id, facilityId: homeFacilityId });
            }
          }
        }
        if (positionId) await syncPrimaryPosition(tx, employeeId, positionId);
      }

      if (seen.size) {
        await tx.update(employees).set({ lastSyncedAt: now }).where(and(eq(employees.organizationId, orgId), inArray(employees.paycorEmployeeId, [...seen])));
      }
    });
  } catch (e) {
    log.error("paycor.sync_apply_failed", { syncLogId: logRow.id, message: (e as Error).message });
    return fail("The sync stopped unexpectedly and was rolled back. No employee records were changed.", (e as Error).message.slice(0, 300));
  }

  const notInFeed = (
    await db.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.organizationId, orgId), sql`${employees.paycorEmployeeId} is not null`, sql`${employees.lastSyncedAt} < ${logRow.startedAt}`))
  )[0].n;

  const status = counts.errors ? "partial" : "success";
  await db
    .update(integrationSyncLogs)
    .set({
      status,
      finishedAt: new Date(),
      recordsReceived: counts.received,
      recordsCreated: counts.created,
      recordsUpdated: counts.updated,
      recordsUnchanged: counts.unchanged,
      recordsDeactivated: counts.deactivated,
      recordsSkipped: counts.skipped,
      errorCount: counts.errors,
      errorSummary: problems.slice(0, 5).join(" ") || null,
      details: { problems: problems.slice(0, 200), unmapped, notInFeed, futureAssignmentsFlagged },
    })
    .where(eq(integrationSyncLogs.id, logRow.id));
  await touchConnections(db, orgId, environment, { lastSuccessAt: new Date(), lastError: counts.errors ? problems[0] : null, status: "connected" }, opts.source.isDemo);
  log.info("paycor.sync_complete", { syncLogId: logRow.id, ...counts });
  return {
    ok: true,
    syncLogId: logRow.id,
    counts,
    message: `${opts.source.label}: ${counts.received} received · ${counts.created} new · ${counts.updated} updated · ${counts.unchanged} unchanged${counts.deactivated ? ` · ${counts.deactivated} deactivated` : ""}${counts.errors ? ` · ${counts.errors} need attention` : ""}.`,
  };
}

async function syncPrimaryPosition(tx: Tx, employeeId: string, positionId: string) {
  const current = await tx.select().from(employeePositions).where(eq(employeePositions.employeeId, employeeId));
  const primary = current.find((p) => p.isPrimary);
  if (primary?.positionId === positionId) return;
  if (primary && primary.source === "manual") return; // a person set it deliberately; leave it
  if (primary) await tx.update(employeePositions).set({ isPrimary: false }).where(eq(employeePositions.id, primary.id));
  const match = current.find((p) => p.positionId === positionId);
  if (match) await tx.update(employeePositions).set({ isPrimary: true, source: "paycor" }).where(eq(employeePositions.id, match.id));
  else await tx.insert(employeePositions).values({ employeeId, positionId, isPrimary: true, source: "paycor" });
}

/**
 * Deactivation side effects. History is preserved: assignments are NOT
 * deleted. Pending claims and waitlist entries are cancelled. Future
 * assignments are kept and reported to schedulers (decision A4).
 */
export async function deactivateEmployee(tx: Tx, ctx: AuditContext, employeeId: string, facilityId: string | null, status: "inactive" | "terminated"): Promise<number> {
  const claims = await tx
    .update(shiftClaims)
    .set({ status: "cancelled", decisionReason: `Employee became ${status} in Paycor`, decidedAt: new Date() })
    .where(and(eq(shiftClaims.employeeId, employeeId), eq(shiftClaims.status, "pending")))
    .returning({ id: shiftClaims.id });
  const waits = await tx
    .update(shiftWaitlists)
    .set({ status: "removed" })
    .where(and(eq(shiftWaitlists.employeeId, employeeId), inArray(shiftWaitlists.status, ["waiting", "offered"])))
    .returning({ id: shiftWaitlists.id });
  const [{ n: future }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(shiftAssignments)
    .where(and(eq(shiftAssignments.employeeId, employeeId), eq(shiftAssignments.status, "assigned"), gt(shiftAssignments.startsAt, new Date())));
  // Pool classification is owned by SNF Workforce and is deliberately left as-is.
  await audit(tx, ctx, {
    action: "employee.deactivated",
    entityType: "employee",
    entityId: employeeId,
    facilityId,
    after: { status, cancelledClaims: claims.length, removedFromWaitlists: waits.length, futureAssignmentsNeedingReview: future },
  });
  return future;
}

async function touchConnections(db: Db, orgId: string, environment: "mock" | "sandbox" | "production", patch: Partial<typeof integrationConnections.$inferInsert>, isDemo: boolean) {
  if (isDemo) {
    await db
      .insert(integrationConnections)
      .values({ organizationId: orgId, provider: "paycor", environment: "mock", legalEntityId: null, displayName: "Paycor (demonstration data)", ...patch })
      .onConflictDoUpdate({ target: [integrationConnections.organizationId, integrationConnections.provider, integrationConnections.environment, integrationConnections.legalEntityId], set: patch });
    return;
  }
  await db
    .update(integrationConnections)
    .set(patch)
    .where(and(eq(integrationConnections.organizationId, orgId), eq(integrationConnections.provider, "paycor"), eq(integrationConnections.environment, environment)));
}
