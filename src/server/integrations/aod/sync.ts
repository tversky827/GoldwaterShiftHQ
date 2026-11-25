/**
 * Attendance on Demand → timekeeping_records. READ-ONLY with respect to AOD:
 * punches are never edited here. Records are linked to employees only when
 * the employee number matches exactly one employee; otherwise they stay
 * unlinked and appear on the reconciliation screen. Never creates employees.
 */
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { employees, facilities, integrationConnections, integrationFieldMappings, integrationSyncLogs, timekeepingRecords } from "@/db/schema";
import { log } from "../../log";
import { employeeMatchField, getAodConfig, missingAodSettings } from "../config";
import { IntegrationHttpError } from "../http";
import { assertCanWrite } from "../ownership";
import type { AodSource } from "./types";

const norm = (k?: string | null) => (k ?? "").trim().replace(/^0+(?=\d)/, "").toUpperCase();

export async function syncAodTimekeeping(
  db: Db,
  opts: { organizationId: string; source: AodSource; trigger: "manual" | "scheduled" | "system"; actorUserId?: string | null; days?: number },
) {
  const cfg = getAodConfig();
  const environment = opts.source.isDemo ? "mock" : cfg.environment;
  const orgId = opts.organizationId;
  const [running] = await db
    .select({ id: integrationSyncLogs.id })
    .from(integrationSyncLogs)
    .where(and(eq(integrationSyncLogs.organizationId, orgId), eq(integrationSyncLogs.provider, "aod"), eq(integrationSyncLogs.status, "running"), gt(integrationSyncLogs.startedAt, new Date(Date.now() - 30 * 60_000))));
  if (running) return { ok: false, message: "An Attendance on Demand synchronization is already in progress." };

  const [logRow] = await db
    .insert(integrationSyncLogs)
    .values({ organizationId: orgId, provider: "aod", environment, syncType: "timekeeping", trigger: opts.trigger, initiatedBy: opts.actorUserId ?? null })
    .returning();

  const touch = async (patch: Partial<typeof integrationConnections.$inferInsert>) => {
    await db
      .insert(integrationConnections)
      .values({ organizationId: orgId, provider: "aod", environment, legalEntityId: null, displayName: opts.source.label, ...patch })
      .onConflictDoUpdate({ target: [integrationConnections.organizationId, integrationConnections.provider, integrationConnections.environment, integrationConnections.legalEntityId], set: patch });
  };
  const fail = async (message: string) => {
    await db.update(integrationSyncLogs).set({ status: "failed", finishedAt: new Date(), errorCount: 1, errorSummary: message }).where(eq(integrationSyncLogs.id, logRow.id));
    await touch({ lastFailureAt: new Date(), lastError: message, status: "needs_attention" });
    return { ok: false, message, syncLogId: logRow.id };
  };

  const missing = opts.source.isDemo ? [] : missingAodSettings(cfg);
  if (missing.length) return fail(`Missing settings: ${missing.join(", ")}`);

  const to = new Date();
  const from = new Date(to.getTime() - (opts.days ?? 14) * 86_400_000);
  let records;
  try {
    records = await opts.source.fetchAttendance(from, to);
    // Facilities the organization doesn't schedule in ShiftHQ (AOD_IGNORE_FACILITIES).
    const ignored = new Set(cfg.ignoreFacilities ?? []);
    if (ignored.size) records = records.filter((r) => !(r.facility && ignored.has(r.facility.toLowerCase())));
  } catch (e) {
    return fail(e instanceof IntegrationHttpError ? e.plainEnglish : (e as Error).message);
  }

  assertCanWrite("aod", ["punchIn", "punchOut", "hours", "approved"]);
  const field = employeeMatchField();
  let linked = 0;
  let unlinked = 0;
  try {
    await db.transaction(async (tx) => {
      const emps = await tx
        .select({ id: employees.id, key: field === "badgeNumber" ? employees.badgeNumber : employees.employeeNumber })
        .from(employees)
        .where(eq(employees.organizationId, orgId));
      const byKey = new Map<string, string[]>();
      for (const e of emps) {
        const k = norm(e.key);
        if (k) byKey.set(k, [...(byKey.get(k) ?? []), e.id]);
      }
      const maps = await tx.select().from(integrationFieldMappings).where(and(eq(integrationFieldMappings.organizationId, orgId), eq(integrationFieldMappings.sourceType, "location")));
      const facs = await tx.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.organizationId, orgId));
      const facByName = new Map<string, string>();
      for (const f of facs) facByName.set(f.name.toLowerCase(), f.id);
      for (const m of maps.filter((m) => m.provider === "paycor")) if (m.facilityId) facByName.set(m.sourceValue.toLowerCase(), m.facilityId);
      for (const m of maps.filter((m) => m.provider === "aod")) if (m.facilityId) facByName.set(m.sourceValue.toLowerCase(), m.facilityId);

      for (const r of records) {
        const ids = byKey.get(norm(r.aodEmployeeKey));
        const employeeId = ids?.length === 1 ? ids[0] : null;
        if (employeeId) linked++;
        else unlinked++;
        const values = {
          organizationId: orgId,
          source: "aod" as const,
          externalId: r.id,
          externalEmployeeKey: r.aodEmployeeKey || null,
          employeeId,
          facilityId: r.facility ? (facByName.get(r.facility.toLowerCase()) ?? null) : null,
          externalFacility: r.facility ?? null,
          workDate: r.workDate,
          punchIn: r.punchIn ? new Date(r.punchIn) : null,
          punchOut: r.punchOut ? new Date(r.punchOut) : null,
          hours: r.hours !== undefined ? String(r.hours) : null,
          approved: r.approved ?? null,
          syncLogId: logRow.id,
          isDemo: r.isMock,
          importedAt: new Date(),
        };
        const { organizationId: _o, source: _s, externalId: _e, ...updatable } = values;
        await tx
          .insert(timekeepingRecords)
          .values(values)
          .onConflictDoUpdate({ target: [timekeepingRecords.organizationId, timekeepingRecords.source, timekeepingRecords.externalId], set: updatable });
      }
    });
  } catch (e) {
    log.error("aod.sync_apply_failed", { message: (e as Error).message });
    return fail("The timekeeping import stopped unexpectedly and was rolled back. No records were changed.");
  }

  await db
    .update(integrationSyncLogs)
    .set({ status: "success", finishedAt: new Date(), recordsReceived: records.length, recordsCreated: records.length, details: { linked, unlinked } })
    .where(eq(integrationSyncLogs.id, logRow.id));
  await touch({ lastSuccessAt: new Date(), lastError: null, status: "connected" });
  return { ok: true, syncLogId: logRow.id, message: `${opts.source.label}: ${records.length} attendance records imported (${linked} linked to employees, ${unlinked} unmatched).` };
}
