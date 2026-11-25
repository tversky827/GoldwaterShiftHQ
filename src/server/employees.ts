import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import {
  credentialTypes,
  departments,
  employeeCredentials,
  employeePayRates,
  employeeFacilityAuthorizations,
  employeePositions,
  employees,
  facilities,
  positions,
  shiftAssignments,
  shifts,
  users,
} from "@/db/schema";
import { audit, type AuditContext } from "./audit";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { assertCan, can, canOnEmployee, employeeScopeSql, hasOrgWide, type Actor } from "./rbac/access";

export interface EmployeeFilters {
  q?: string;
  facilityId?: string;
  departmentId?: string;
  positionId?: string;
  status?: "active" | "inactive" | "terminated" | "leave" | "all";
  pool?: "pool" | "non_pool" | "all";
  employmentType?: string;
  page?: number;
  pageSize?: number;
}

export async function listEmployees(db: Db, actor: Actor, f: EmployeeFilters = {}) {
  assertCan(actor, "employees.view");
  const where: SQL[] = [employeeScopeSql(actor, "employees.view")];
  if (f.q?.trim()) {
    const q = `%${f.q.trim().replace(/[%_]/g, "")}%`;
    where.push(or(ilike(employees.firstName, q), ilike(employees.lastName, q), ilike(employees.preferredName, q), ilike(employees.employeeNumber, q))!);
  }
  if (f.facilityId) {
    where.push(
      or(
        eq(employees.homeFacilityId, f.facilityId),
        sql`exists (select 1 from ${employeeFacilityAuthorizations} efa where efa.employee_id = ${employees.id} and efa.revoked_at is null and efa.facility_id = ${f.facilityId}::uuid)`,
      )!,
    );
  }
  if (f.departmentId) where.push(eq(employees.homeDepartmentId, f.departmentId));
  if (f.positionId) where.push(sql`exists (select 1 from ${employeePositions} ep where ep.employee_id = ${employees.id} and ep.position_id = ${f.positionId}::uuid)`);
  const status = f.status ?? "active";
  if (status !== "all") where.push(eq(employees.employmentStatus, status));
  if (f.pool === "pool") where.push(eq(employees.isRegionalPool, true));
  if (f.pool === "non_pool") where.push(eq(employees.isRegionalPool, false));
  if (f.employmentType) where.push(sql`${employees.employmentType} = ${f.employmentType}`);

  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  const cond = and(...where);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        preferredName: employees.preferredName,
        employeeNumber: employees.employeeNumber,
        employmentStatus: employees.employmentStatus,
        employmentType: employees.employmentType,
        isRegionalPool: employees.isRegionalPool,
        homeFacilityId: employees.homeFacilityId,
        facilityName: facilities.name,
        departmentName: departments.name,
        isDemo: employees.isDemo,
        source: employees.source,
      })
      .from(employees)
      .leftJoin(facilities, eq(facilities.id, employees.homeFacilityId))
      .leftJoin(departments, eq(departments.id, employees.homeDepartmentId))
      .where(cond)
      .orderBy(asc(employees.lastName), asc(employees.firstName))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(employees).where(cond),
  ]);
  const ids = rows.map((r) => r.id);
  const pos = ids.length
    ? await db
        .select({ employeeId: employeePositions.employeeId, code: positions.code, isPrimary: employeePositions.isPrimary })
        .from(employeePositions)
        .innerJoin(positions, eq(positions.id, employeePositions.positionId))
        .where(inArray(employeePositions.employeeId, ids))
    : [];
  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({
      ...r,
      positions: pos
        .filter((p) => p.employeeId === r.id)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
        .map((p) => p.code),
    })),
  };
}

export async function getEmployeeProfile(db: Db, actor: Actor, employeeId: string) {
  const isSelf = actor.employeeId === employeeId;
  if (!isSelf && !(await canOnEmployee(db, actor, "employees.view", employeeId))) throw new ForbiddenError();
  const [e] = await db
    .select({ employee: employees, facilityName: facilities.name, departmentName: departments.name })
    .from(employees)
    .leftJoin(facilities, eq(facilities.id, employees.homeFacilityId))
    .leftJoin(departments, eq(departments.id, employees.homeDepartmentId))
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)));
  if (!e) throw new NotFoundError("Employee");
  const showContact = isSelf || (await canOnEmployee(db, actor, "employees.view_contact", employeeId));
  // Pay is restricted: never shown to the employee's peers, only with pay.view.
  const showPay = !isSelf && (await canOnEmployee(db, actor, "pay.view", employeeId));
  const payRates = showPay ? await db.select().from(employeePayRates).where(eq(employeePayRates.employeeId, employeeId)).orderBy(desc(employeePayRates.effectiveFrom)).limit(10) : [];

  const [pos, creds, auths, history, [account]] = await Promise.all([
    db
      .select({ id: employeePositions.id, positionId: positions.id, code: positions.code, name: positions.name, isPrimary: employeePositions.isPrimary, source: employeePositions.source })
      .from(employeePositions)
      .innerJoin(positions, eq(positions.id, employeePositions.positionId))
      .where(eq(employeePositions.employeeId, employeeId)),
    db
      .select({ credential: employeeCredentials, typeName: credentialTypes.name, typeCode: credentialTypes.code })
      .from(employeeCredentials)
      .innerJoin(credentialTypes, eq(credentialTypes.id, employeeCredentials.credentialTypeId))
      .where(eq(employeeCredentials.employeeId, employeeId)),
    db
      .select({ authorization: employeeFacilityAuthorizations, facilityName: facilities.name })
      .from(employeeFacilityAuthorizations)
      .innerJoin(facilities, eq(facilities.id, employeeFacilityAuthorizations.facilityId))
      .where(and(eq(employeeFacilityAuthorizations.employeeId, employeeId), isNull(employeeFacilityAuthorizations.revokedAt))),
    db
      .select({ id: shiftAssignments.id, startsAt: shiftAssignments.startsAt, endsAt: shiftAssignments.endsAt, status: shiftAssignments.status, facilityName: facilities.name, positionCode: positions.code })
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .innerJoin(facilities, eq(facilities.id, shiftAssignments.facilityId))
      .innerJoin(positions, eq(positions.id, shifts.positionId))
      .where(eq(shiftAssignments.employeeId, employeeId))
      .orderBy(desc(shiftAssignments.startsAt))
      .limit(50),
    db.select({ id: users.id, status: users.status, email: users.email, lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.employeeId, employeeId)),
  ]);

  const emp = e.employee;
  return {
    employee: {
      ...emp,
      email: showContact ? emp.email : null,
      mobilePhone: showContact ? emp.mobilePhone : null,
      // Raw source values are only useful to administrators.
      sourceHash: undefined,
    },
    facilityName: e.facilityName,
    departmentName: e.departmentName,
    showContact,
    showPay,
    payRates,
    positions: pos,
    credentials: creds,
    authorizations: auths,
    history,
    account: account ?? null,
    permissions: {
      managePool: can(actor, "pool.manage", { pool: true }) || hasOrgWide(actor, "pool.manage"),
      authorizeFacility: can(actor, "employees.authorize_facility"),
      invite: !isSelf && (await canOnEmployee(db, actor, "employees.invite", employeeId)),
    },
  };
}

/** Regional pool classification is owned by SNF Workforce (not Paycor). */
export async function setRegionalPool(db: Db, actor: Actor, ctx: AuditContext, employeeId: string, isPool: boolean, reason: string) {
  if (!hasOrgWide(actor, "pool.manage") && !actor.grants.some((g) => g.scopeType === "pool" && g.permissions.has("pool.manage"))) throw new ForbiddenError();
  if (reason.trim().length < 3) throw new AppError("Please give a short reason.");
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)));
    if (!e) throw new NotFoundError("Employee");
    if (isPool && e.employmentStatus !== "active") throw new AppError("Only active employees can join the regional pool.");
    if (e.isRegionalPool === isPool) return;
    await tx.update(employees).set({ isRegionalPool: isPool, updatedBy: actor.userId }).where(eq(employees.id, employeeId));
    await audit(tx, ctx, {
      action: isPool ? "employee.pool_added" : "employee.pool_removed",
      entityType: "employee",
      entityId: employeeId,
      facilityId: e.homeFacilityId,
      before: { isRegionalPool: e.isRegionalPool },
      after: { isRegionalPool: isPool },
      reason,
    });
  });
}

export async function authorizeFacility(db: Db, actor: Actor, ctx: AuditContext, employeeId: string, facilityId: string, reason: string) {
  assertCan(actor, "employees.authorize_facility", { facilityId });
  if (reason.trim().length < 3) throw new AppError("Please give a short reason.");
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)));
    if (!e) throw new NotFoundError("Employee");
    const [f] = await tx.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
    if (!f) throw new NotFoundError("Facility");
    if (e.homeFacilityId === facilityId) throw new AppError("This is already the employee's home facility.");
    const [existing] = await tx
      .select()
      .from(employeeFacilityAuthorizations)
      .where(and(eq(employeeFacilityAuthorizations.employeeId, employeeId), eq(employeeFacilityAuthorizations.facilityId, facilityId), isNull(employeeFacilityAuthorizations.revokedAt)));
    if (existing) return;
    const [row] = await tx.insert(employeeFacilityAuthorizations).values({ employeeId, facilityId, reason, authorizedBy: actor.userId }).returning();
    await audit(tx, ctx, { action: "employee.facility_authorized", entityType: "employee", entityId: employeeId, facilityId, after: { authorizationId: row.id, facility: f.name }, reason });
  });
}

export async function revokeFacilityAuthorization(db: Db, actor: Actor, ctx: AuditContext, authorizationId: string, reason: string) {
  const [a] = await db.select().from(employeeFacilityAuthorizations).where(eq(employeeFacilityAuthorizations.id, authorizationId));
  if (!a || a.revokedAt) throw new NotFoundError("Authorization");
  assertCan(actor, "employees.authorize_facility", { facilityId: a.facilityId });
  await db.transaction(async (tx) => {
    await tx.update(employeeFacilityAuthorizations).set({ revokedAt: new Date(), revokedBy: actor.userId }).where(eq(employeeFacilityAuthorizations.id, authorizationId));
    await audit(tx, ctx, { action: "employee.facility_revoked", entityType: "employee", entityId: a.employeeId, facilityId: a.facilityId, reason });
  });
}

/** Facilities the employee may work at: home facility + active authorizations. */
export async function authorizedFacilityIds(db: Db, employeeId: string): Promise<string[]> {
  const [e] = await db.select({ home: employees.homeFacilityId }).from(employees).where(eq(employees.id, employeeId));
  const auths = await db
    .select({ f: employeeFacilityAuthorizations.facilityId })
    .from(employeeFacilityAuthorizations)
    .where(and(eq(employeeFacilityAuthorizations.employeeId, employeeId), isNull(employeeFacilityAuthorizations.revokedAt)));
  return [...new Set([e?.home, ...auths.map((a) => a.f)].filter((x): x is string => !!x))];
}
