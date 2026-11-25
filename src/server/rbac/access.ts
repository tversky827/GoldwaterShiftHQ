/**
 * Authorization core. Every server-side read and write goes through these
 * helpers. Grants are role permissions scoped to:
 *   organization (all facilities) · facility · department · pool (regional pool).
 */
import { and, eq, exists, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { employeeFacilityAuthorizations, employees, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { ForbiddenError } from "../errors";
import { FACILITY_LEVEL_READ, type Permission } from "./catalog";

export interface Grant {
  roleKey: string;
  roleName: string;
  scopeType: "organization" | "facility" | "department" | "pool";
  facilityId: string | null;
  departmentId: string | null;
  permissions: Set<Permission>;
}

export interface Actor {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  employeeId: string | null;
  isDemo: boolean;
  grants: Grant[];
}

export interface Target {
  facilityId?: string | null;
  /** Omit to ask about the facility as a whole; pass null for "no department". */
  departmentId?: string | null;
  /** True when the record is a regional pool employee. */
  pool?: boolean;
}

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.status !== "active") return null;
  const rows = await db
    .select({
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      scopeType: userRoles.scopeType,
      facilityId: userRoles.facilityId,
      departmentId: userRoles.departmentId,
      permission: rolePermissions.permissionKey,
      grantId: userRoles.id,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));
  const byGrant = new Map<string, Grant>();
  for (const r of rows) {
    let g = byGrant.get(r.grantId);
    if (!g) {
      g = { roleKey: r.roleKey, roleName: r.roleName, scopeType: r.scopeType, facilityId: r.facilityId, departmentId: r.departmentId, permissions: new Set() };
      byGrant.set(r.grantId, g);
    }
    if (r.permission) g.permissions.add(r.permission as Permission);
  }
  return {
    userId: u.id,
    organizationId: u.organizationId,
    email: u.email,
    displayName: u.displayName,
    employeeId: u.employeeId,
    isDemo: u.isDemo,
    grants: [...byGrant.values()],
  };
}

function grantMatches(g: Grant, perm: Permission, t?: Target): boolean {
  if (!g.permissions.has(perm)) return false;
  if (perm.startsWith("self.")) return true; // checked against actor.employeeId by callers
  if (g.scopeType === "organization") return true;
  if (!t) return false;
  if (g.scopeType === "pool") {
    if (t.pool) return true;
    return t.departmentId === undefined && FACILITY_LEVEL_READ.includes(perm);
  }
  if (!t.facilityId || t.facilityId !== g.facilityId) return false;
  if (g.scopeType === "facility") return true;
  // department scope
  if (t.departmentId === undefined) return FACILITY_LEVEL_READ.includes(perm);
  return t.departmentId === g.departmentId;
}

/** Does the actor hold `perm` for this target? Without a target: anywhere at all. */
export function can(actor: Actor, perm: Permission, target?: Target): boolean {
  if (!target) return actor.grants.some((g) => g.permissions.has(perm));
  return actor.grants.some((g) => grantMatches(g, perm, target));
}

export function assertCan(actor: Actor, perm: Permission, target?: Target): void {
  if (!can(actor, perm, target)) throw new ForbiddenError();
}

export function hasOrgWide(actor: Actor, perm: Permission): boolean {
  return actor.grants.some((g) => g.scopeType === "organization" && g.permissions.has(perm));
}

/** Facilities where the actor holds `perm`: "all" or a list of IDs. */
export function facilityScope(actor: Actor, perm: Permission): "all" | string[] {
  const ids = new Set<string>();
  for (const g of actor.grants) {
    if (!g.permissions.has(perm)) continue;
    if (g.scopeType === "organization") return "all";
    if (g.scopeType === "pool" && FACILITY_LEVEL_READ.includes(perm)) return "all";
    if (g.facilityId) ids.add(g.facilityId);
  }
  return [...ids];
}

/** True if the user is a staff user (has any non-self permission). */
export function isStaff(actor: Actor): boolean {
  return actor.grants.some((g) => [...g.permissions].some((p) => !p.startsWith("self.")));
}

/**
 * SQL condition restricting `employees` rows to those the actor may see with
 * `perm`: a facility sees its own employees plus employees authorized to work
 * there; department scope sees its department; pool scope sees pool employees.
 * The actor always sees their own employee record.
 */
export function employeeScopeSql(actor: Actor, perm: Permission): SQL {
  const parts: SQL[] = [];
  if (actor.employeeId) parts.push(eq(employees.id, actor.employeeId));
  const facIds: string[] = [];
  for (const g of actor.grants) {
    if (!g.permissions.has(perm)) continue;
    if (g.scopeType === "organization") return eq(employees.organizationId, actor.organizationId);
    if (g.scopeType === "pool") parts.push(eq(employees.isRegionalPool, true));
    if (g.scopeType === "facility" && g.facilityId) facIds.push(g.facilityId);
    if (g.scopeType === "department" && g.facilityId && g.departmentId) {
      parts.push(and(eq(employees.homeFacilityId, g.facilityId), eq(employees.homeDepartmentId, g.departmentId))!);
    }
  }
  if (facIds.length) {
    parts.push(inArray(employees.homeFacilityId, facIds));
    parts.push(
      exists(
        sql`(select 1 from ${employeeFacilityAuthorizations} efa where efa.employee_id = ${employees.id}
             and efa.revoked_at is null and efa.facility_id in (${sql.join(facIds.map((f) => sql`${f}::uuid`), sql`, `)}))`,
      ),
    );
  }
  if (!parts.length) return sql`false`;
  return and(eq(employees.organizationId, actor.organizationId), or(...parts))!;
}

/** Target describing an employee record, for `can()` checks. */
export async function employeeTargets(db: Db, employeeId: string): Promise<Target[]> {
  const [e] = await db
    .select({ f: employees.homeFacilityId, d: employees.homeDepartmentId, pool: employees.isRegionalPool })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!e) return [];
  const auths = await db
    .select({ f: employeeFacilityAuthorizations.facilityId })
    .from(employeeFacilityAuthorizations)
    .where(and(eq(employeeFacilityAuthorizations.employeeId, employeeId), isNull(employeeFacilityAuthorizations.revokedAt)));
  return [
    { facilityId: e.f, departmentId: e.d, pool: e.pool },
    ...auths.map((a) => ({ facilityId: a.f, departmentId: null, pool: e.pool })),
  ];
}

export async function canOnEmployee(db: Db, actor: Actor, perm: Permission, employeeId: string): Promise<boolean> {
  if (actor.employeeId === employeeId && perm === "employees.view") return true;
  return (await employeeTargets(db, employeeId)).some((t) => can(actor, perm, t));
}
