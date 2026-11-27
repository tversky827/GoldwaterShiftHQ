import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  departments,
  employeeFacilityAuthorizations,
  employees,
  facilities,
  integrationConnections,
  integrationFieldMappings,
  integrationSyncLogs,
  positions,
  timekeepingRecords,
} from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError } from "../errors";
import { hasOrgWide, type Actor } from "../rbac/access";
import { AodFileSource } from "./aod/file";
import { DemoAodSource } from "./aod/demo";
import { AodSoapClient } from "./aod/soap";
import { syncAodTimekeeping } from "./aod/sync";
import type { AodSource } from "./aod/types";
import { getAodConfig, getPaycorConfig, missingAodSettings, missingPaycorSettings } from "./config";
import { PaycorClient } from "./paycor/client";
import { DemoPaycorSource } from "./paycor/demo";
import { syncPaycorEmployees } from "./paycor/sync";
import type { ConnectionTestResult, PaycorSource } from "./paycor/types";

export type Provider = "paycor" | "aod";

function requireIntegrationAccess(actor: Actor, manage = false) {
  if (!hasOrgWide(actor, manage ? "integrations.manage" : "integrations.view")) throw new AppError("Only corporate administrators can manage integrations.", "FORBIDDEN", 403);
}

export function paycorSource(db: Db, orgId: string): PaycorSource {
  return getPaycorConfig().mode === "demo" ? new DemoPaycorSource() : new PaycorClient(db, orgId);
}

export async function aodSource(db: Db, orgId: string): Promise<AodSource> {
  const c = getAodConfig();
  if (c.mode === "file") return new AodFileSource(c);
  if (c.mode === "soap") return new AodSoapClient(c);
  const roster = await db
    .select({ employeeNumber: employees.employeeNumber, firstName: employees.firstName, lastName: employees.lastName, location: employees.paycorLocation, status: employees.employmentStatus })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.isDemo, true), isNotNull(employees.employeeNumber), ne(employees.employmentStatus, "leave")));
  return new DemoAodSource(
    roster.filter((r) => r.employeeNumber && r.location).map((r) => ({ employeeNumber: r.employeeNumber!, firstName: r.firstName, lastName: r.lastName, location: r.location!, active: r.status === "active" })),
  );
}

export async function runSync(db: Db, provider: Provider, opts: { organizationId: string; trigger: "manual" | "scheduled" | "system"; actorUserId?: string | null; ctx?: AuditContext }) {
  if (provider === "paycor") return syncPaycorEmployees(db, { ...opts, source: paycorSource(db, opts.organizationId) });
  return syncAodTimekeeping(db, { ...opts, source: await aodSource(db, opts.organizationId) });
}

export async function syncNow(db: Db, actor: Actor, ctx: AuditContext, provider: Provider) {
  requireIntegrationAccess(actor, true);
  await audit(db, ctx, { action: `integration.${provider}.sync_requested`, entityType: "integration", entityId: null });
  return runSync(db, provider, { organizationId: actor.organizationId, trigger: "manual", actorUserId: actor.userId, ctx });
}

export async function testConnection(db: Db, actor: Actor, ctx: AuditContext, provider: Provider): Promise<ConnectionTestResult> {
  requireIntegrationAccess(actor, true);
  const missing = provider === "paycor" ? missingPaycorSettings() : missingAodSettings();
  let result: ConnectionTestResult;
  if (missing.length) result = { ok: false, message: `These settings are missing: ${missing.join(", ")}. See the setup guide.` };
  else {
    const src = provider === "paycor" ? paycorSource(db, actor.organizationId) : await aodSource(db, actor.organizationId);
    result = await src.testConnection().catch((e: Error) => ({ ok: false, message: e.message }));
  }
  const environment = provider === "paycor" ? getPaycorConfig().environment : getAodConfig().environment;
  const patch = { lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message };
  const updated = await db
    .update(integrationConnections)
    .set(patch)
    .where(and(eq(integrationConnections.organizationId, actor.organizationId), eq(integrationConnections.provider, provider), eq(integrationConnections.environment, environment)))
    .returning({ id: integrationConnections.id });
  if (!updated.length) {
    await db.insert(integrationConnections).values({
      organizationId: actor.organizationId,
      provider,
      environment,
      legalEntityId: null,
      displayName: provider === "paycor" ? "Paycor" : "Attendance on Demand",
      status: result.ok ? "connected" : provider === "paycor" && environment !== "mock" ? "pending_authorization" : "needs_attention",
      ...patch,
    });
  }
  await audit(db, ctx, { action: `integration.${provider}.connection_tested`, entityType: "integration", after: { ok: result.ok } });
  return result;
}

export type DisplayStatus = "connected" | "needs_attention" | "disconnected" | "syncing";

export async function integrationOverview(db: Db, actor: Actor) {
  requireIntegrationAccess(actor);
  const orgId = actor.organizationId;
  const pc = getPaycorConfig();
  const ac = getAodConfig();
  const [conns, logs, [empCount], [tkCount], [unmatchedTk]] = await Promise.all([
    db.select().from(integrationConnections).where(eq(integrationConnections.organizationId, orgId)),
    db.select().from(integrationSyncLogs).where(eq(integrationSyncLogs.organizationId, orgId)).orderBy(desc(integrationSyncLogs.startedAt)).limit(30),
    db.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.organizationId, orgId), isNotNull(employees.paycorEmployeeId))),
    db.select({ n: sql<number>`count(*)::int` }).from(timekeepingRecords).where(eq(timekeepingRecords.organizationId, orgId)),
    db.select({ n: sql<number>`count(distinct coalesce(${timekeepingRecords.externalEmployeeKey}, ''))::int` }).from(timekeepingRecords).where(and(eq(timekeepingRecords.organizationId, orgId), isNull(timekeepingRecords.employeeId))),
  ]);

  const summarize = (provider: Provider, environment: string, missing: string[]) => {
    const mine = conns.filter((c) => c.provider === provider && c.environment === environment);
    const myLogs = logs.filter((l) => l.provider === provider);
    const latest = myLogs[0];
    const lastSuccess = myLogs.find((l) => l.status === "success" || l.status === "partial");
    const lastFailure = myLogs.find((l) => l.status === "failed");
    let status: DisplayStatus;
    let reason: string;
    if (latest?.status === "running" && Date.now() - latest.startedAt.getTime() < 30 * 60_000) {
      status = "syncing";
      reason = "Synchronization in progress.";
    } else if (missing.length) {
      status = "disconnected";
      reason = `Missing settings: ${missing.join(", ")}`;
    } else if (provider === "paycor" && environment !== "mock" && !mine.some((c) => c.refreshTokenEnc)) {
      status = "disconnected";
      reason = "Paycor has not been authorized yet. Use “Connect Paycor”.";
    } else if (mine.some((c) => c.lastTestOk === false) || latest?.status === "failed") {
      status = "needs_attention";
      reason = latest?.status === "failed" ? (latest.errorSummary ?? "The last synchronization failed.") : (mine.find((c) => c.lastTestOk === false)?.lastTestMessage ?? "The last connection test failed.");
    } else if (latest?.status === "partial") {
      status = "needs_attention";
      reason = `Last sync finished with ${latest.errorCount} item(s) needing attention.`;
    } else if (lastSuccess || mine.some((c) => c.lastTestOk)) {
      status = "connected";
      reason = "Working normally.";
    } else {
      status = "disconnected";
      reason = "Not tested yet. Click “Test connection”.";
    }
    return {
      provider,
      environment,
      status,
      reason,
      connections: mine.map(({ accessTokenEnc: _a, refreshTokenEnc, ...c }) => ({ ...c, authorized: !!refreshTokenEnc })),
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      lastFailureAt: lastFailure?.finishedAt ?? null,
      lastFailureMessage: lastFailure?.errorSummary ?? null,
      lastTest: mine.find((c) => c.lastTestAt) ?? null,
      latestLog: latest ?? null,
    };
  };

  const paycor = summarize("paycor", pc.environment, missingPaycorSettings(pc));
  const aod = summarize("aod", ac.environment, missingAodSettings(ac));
  const latestPaycor = logs.find((l) => l.provider === "paycor" && l.details);
  const pendingErrors = logs.filter((l) => l.status === "failed" || l.status === "partial").slice(0, 10);
  return {
    paycor: { ...paycor, mode: pc.mode, redirectUri: pc.redirectUri },
    aod: { ...aod, mode: ac.mode },
    counts: { employeesImported: empCount.n, attendanceRecords: tkCount.n, unmatchedTimekeepingEmployees: unmatchedTk.n, pendingErrors: pendingErrors.length },
    unmapped: ((latestPaycor?.details as { unmapped?: Record<string, Record<string, number>> } | null)?.unmapped ?? { legalEntities: {}, locations: {}, positions: {}, departments: {} }) as Record<string, Record<string, number>>,
    history: logs,
    pendingErrors,
  };
}

/* ------------------------------------------------------------ mappings */

export async function listMappings(db: Db, actor: Actor) {
  requireIntegrationAccess(actor);
  return db
    .select({ mapping: integrationFieldMappings, facilityName: facilities.name, departmentName: departments.name, positionName: positions.name })
    .from(integrationFieldMappings)
    .leftJoin(facilities, eq(facilities.id, integrationFieldMappings.facilityId))
    .leftJoin(departments, eq(departments.id, integrationFieldMappings.departmentId))
    .leftJoin(positions, eq(positions.id, integrationFieldMappings.positionId))
    .where(eq(integrationFieldMappings.organizationId, actor.organizationId))
    .orderBy(integrationFieldMappings.sourceType, integrationFieldMappings.sourceValue);
}

export async function saveMapping(
  db: Db,
  actor: Actor,
  ctx: AuditContext,
  input: { provider: Provider; sourceType: "location" | "legal_entity" | "department" | "position"; sourceValue: string; facilityId?: string | null; departmentId?: string | null; positionId?: string | null },
) {
  requireIntegrationAccess(actor, true);
  const sourceValue = input.sourceValue.trim();
  if (!sourceValue) throw new AppError("Enter the value exactly as it appears in the source system.");
  if ((input.sourceType === "location" || input.sourceType === "legal_entity") && !input.facilityId) throw new AppError("Choose a facility.");
  if (input.sourceType === "position" && !input.positionId) throw new AppError("Choose a job classification.");
  if (input.sourceType === "department" && !input.departmentId) throw new AppError("Choose a department.");
  if (input.sourceType === "department") {
    const [d] = await db
      .select({ facilityId: departments.facilityId })
      .from(departments)
      .innerJoin(facilities, eq(facilities.id, departments.facilityId))
      .where(and(eq(departments.id, input.departmentId!), eq(facilities.organizationId, actor.organizationId)));
    if (!d) throw new AppError("That department doesn't exist.");
    input = { ...input, facilityId: d.facilityId };
  }
  const values = {
    organizationId: actor.organizationId,
    provider: input.provider,
    sourceType: input.sourceType,
    sourceValue,
    facilityId: input.facilityId ?? null,
    departmentId: input.departmentId ?? null,
    positionId: input.positionId ?? null,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  await db.transaction(async (tx) => {
    // A location/position value maps to exactly one target. Department values
    // are mapped per facility (each facility has its own departments).
    const sameValue = and(
      eq(integrationFieldMappings.organizationId, actor.organizationId),
      eq(integrationFieldMappings.provider, input.provider),
      eq(integrationFieldMappings.sourceType, input.sourceType),
      eq(integrationFieldMappings.sourceValue, sourceValue),
    );
    await tx
      .delete(integrationFieldMappings)
      .where(input.sourceType === "department" ? and(sameValue, values.facilityId ? eq(integrationFieldMappings.facilityId, values.facilityId) : isNull(integrationFieldMappings.facilityId)) : sameValue);
    await tx.insert(integrationFieldMappings).values(values);
    await audit(tx, ctx, { action: "integration.mapping_saved", entityType: "integration_mapping", facilityId: values.facilityId, after: values });
  });
}

/* ------------------------------------------------------- reconciliation */

export interface ReconIssue {
  type: string;
  label: string;
  severity: "high" | "medium" | "low";
  message: string;
  employeeId?: string;
  count?: number;
}

export async function reconciliation(db: Db, actor: Actor): Promise<ReconIssue[]> {
  requireIntegrationAccess(actor);
  const orgId = actor.organizationId;
  const issues: ReconIssue[] = [];
  const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

  const missingNumbers = await db
    .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.employmentStatus, "active"), isNull(employees.employeeNumber)));
  for (const e of missingNumbers) issues.push({ type: "missing_id", label: "Missing employee number", severity: "high", employeeId: e.id, message: `${name(e)} has no employee number in Paycor, so timekeeping can't be linked.` });

  const dupes = await db.execute(sql`
    select employee_number, count(*)::int as n, array_agg(first_name || ' ' || last_name) as names
    from employees where organization_id = ${orgId} and employee_number is not null
    group by employee_number having count(*) > 1`);
  for (const d of (dupes as unknown as { rows: { employee_number: string; n: number; names: string[] }[] }).rows) {
    issues.push({ type: "duplicate", label: "Duplicate employee number", severity: "high", count: d.n, message: `Employee number ${d.employee_number} is used by ${d.n} records (${d.names.join(", ")}). Timekeeping for this number won't be linked until it's fixed in Paycor.` });
  }

  const noFacility = await db
    .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, loc: employees.paycorLocation })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.employmentStatus, "active"), isNull(employees.homeFacilityId), eq(employees.isRegionalPool, false)));
  for (const e of noFacility) issues.push({ type: "no_facility", label: "No home facility", severity: "medium", employeeId: e.id, message: `${name(e)} has no home facility${e.loc ? ` (Paycor location “${e.loc}” isn't mapped)` : ""} and isn't in the regional pool.` });

  const unmatched = await db
    .select({ key: timekeepingRecords.externalEmployeeKey, n: sql<number>`count(*)::int` })
    .from(timekeepingRecords)
    .where(and(eq(timekeepingRecords.organizationId, orgId), isNull(timekeepingRecords.employeeId)))
    .groupBy(timekeepingRecords.externalEmployeeKey);
  for (const u of unmatched) issues.push({ type: "unmatched_timekeeping", label: "Timekeeping not matched", severity: "high", count: u.n, message: `${u.n} Attendance on Demand record(s) for employee number “${u.key ?? "(blank)"}” don't match exactly one Paycor employee. Fix the number in Paycor or AOD; employees are never created from timekeeping data.` });

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const inactivePunching = await db
    .selectDistinct({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, status: employees.employmentStatus })
    .from(timekeepingRecords)
    .innerJoin(employees, eq(employees.id, timekeepingRecords.employeeId))
    .where(and(eq(timekeepingRecords.organizationId, orgId), gte(timekeepingRecords.workDate, since), inArray(employees.employmentStatus, ["inactive", "terminated"])));
  for (const e of inactivePunching) issues.push({ type: "inactive_punching", label: "Inactive employee with recent punches", severity: "high", employeeId: e.id, message: `${name(e)} is ${e.status} in Paycor but has punches in the last 14 days.` });

  const wrongFacility = await db.execute(sql`
    select distinct e.id, e.first_name, e.last_name, f.name as facility
    from timekeeping_records t
    join employees e on e.id = t.employee_id
    join facilities f on f.id = t.facility_id
    where t.organization_id = ${orgId} and t.work_date >= ${since}
      and e.is_regional_pool = false
      and t.facility_id is distinct from e.home_facility_id
      and not exists (select 1 from ${employeeFacilityAuthorizations} a where a.employee_id = e.id and a.facility_id = t.facility_id and a.revoked_at is null)`);
  for (const r of (wrongFacility as unknown as { rows: { id: string; first_name: string; last_name: string; facility: string }[] }).rows) {
    issues.push({ type: "unauthorized_facility", label: "Punched at an unauthorized facility", severity: "medium", employeeId: r.id, message: `${r.first_name} ${r.last_name} punched at ${r.facility}, which is neither their home facility nor an authorized facility.` });
  }
  return issues;
}
