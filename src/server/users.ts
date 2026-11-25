import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { departments, employees, facilities, permissions, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { audit, type AuditContext } from "./audit";
import { createInvitation, revokeAllSessions } from "./auth/service";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { canOnEmployee, hasOrgWide, type Actor } from "./rbac/access";
import { ALL_PERMISSIONS, type Permission } from "./rbac/catalog";

function requireOrgAdmin(actor: Actor, perm: Permission) {
  if (!hasOrgWide(actor, perm)) throw new ForbiddenError("Only corporate administrators can manage user access.");
}

export async function listUsers(db: Db, actor: Actor) {
  requireOrgAdmin(actor, "users.view");
  const rows = await db.select().from(users).where(eq(users.organizationId, actor.organizationId)).orderBy(asc(users.displayName));
  const grants = await db
    .select({
      id: userRoles.id,
      userId: userRoles.userId,
      roleName: roles.name,
      roleKey: roles.key,
      scopeType: userRoles.scopeType,
      facilityName: facilities.name,
      departmentName: departments.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(facilities, eq(facilities.id, userRoles.facilityId))
    .leftJoin(departments, eq(departments.id, userRoles.departmentId))
    .where(and(eq(roles.organizationId, actor.organizationId), isNull(userRoles.revokedAt)));
  return rows.map(({ passwordHash: _p, ...u }) => ({ ...u, grants: grants.filter((g) => g.userId === u.id) }));
}

export const inviteUserInput = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    displayName: z.string().trim().min(2, "Enter the person's name.").max(120),
    roleId: z.string().uuid("Choose a role."),
    scopeType: z.enum(["organization", "facility", "department", "pool"]),
    facilityId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    departmentId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  })
  .superRefine((v, ctx) => {
    if ((v.scopeType === "facility" || v.scopeType === "department") && !v.facilityId) ctx.addIssue({ code: "custom", path: ["facilityId"], message: "Choose a facility." });
    if (v.scopeType === "department" && !v.departmentId) ctx.addIssue({ code: "custom", path: ["departmentId"], message: "Choose a department." });
  });

async function validateScope(db: Db, actor: Actor, scopeType: string, facilityId?: string | null, departmentId?: string | null) {
  if (facilityId) {
    const [f] = await db.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, actor.organizationId)));
    if (!f) throw new AppError("That facility doesn't exist.");
  }
  if (departmentId) {
    const [d] = await db.select({ f: departments.facilityId }).from(departments).where(eq(departments.id, departmentId));
    if (!d || d.f !== facilityId) throw new AppError("That department doesn't belong to the chosen facility.");
  }
  return {
    scopeType: scopeType as "organization" | "facility" | "department" | "pool",
    facilityId: scopeType === "facility" || scopeType === "department" ? (facilityId ?? null) : null,
    departmentId: scopeType === "department" ? (departmentId ?? null) : null,
  };
}

/** Creates a staff user with one role and returns the one-time invitation token. */
export async function inviteUser(db: Db, actor: Actor, ctx: AuditContext, input: z.infer<typeof inviteUserInput>) {
  requireOrgAdmin(actor, "users.manage");
  const [role] = await db.select().from(roles).where(and(eq(roles.id, input.roleId), eq(roles.organizationId, actor.organizationId)));
  if (!role) throw new AppError("Choose a role.");
  const scope = await validateScope(db, actor, input.scopeType, input.facilityId, input.departmentId);
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
  if (existing) throw new AppError("A user with this email already exists. Add a role to their existing account instead.");
  const userId = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ organizationId: actor.organizationId, email: input.email, displayName: input.displayName, status: "invited", createdBy: actor.userId })
      .returning();
    await tx.insert(userRoles).values({ userId: u.id, roleId: role.id, ...scope, grantedBy: actor.userId });
    await audit(tx, ctx, { action: "user.invited", entityType: "user", entityId: u.id, facilityId: scope.facilityId, after: { email: u.email, role: role.key, ...scope } });
    return u.id;
  });
  return { userId, token: await createInvitation(db, userId, actor.userId) };
}

/** Invites an existing employee to the employee app, linked to their employee record. */
export async function inviteEmployee(db: Db, actor: Actor, ctx: AuditContext, employeeId: string, email: string) {
  if (!(await canOnEmployee(db, actor, "employees.invite", employeeId))) throw new ForbiddenError();
  const parsed = z.string().trim().toLowerCase().email("Enter a valid email address.").safeParse(email);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)));
  if (!e) throw new NotFoundError("Employee");
  if (e.employmentStatus === "inactive" || e.employmentStatus === "terminated") throw new AppError("Inactive employees can't be invited.");
  const [role] = await db.select().from(roles).where(and(eq(roles.organizationId, actor.organizationId), eq(roles.key, "employee")));
  if (!role) throw new AppError("The Employee role is missing. Ask a corporate administrator.");

  const [linked] = await db.select().from(users).where(eq(users.employeeId, employeeId));
  if (linked?.status === "active") throw new AppError("This employee already has an active account.");
  const [byEmail] = await db.select().from(users).where(sql`lower(${users.email}) = ${parsed.data}`);
  if (byEmail && byEmail.employeeId && byEmail.employeeId !== employeeId) throw new AppError("That email belongs to a different employee's account.");

  const userId = await db.transaction(async (tx) => {
    let u = linked ?? byEmail;
    if (!u) {
      [u] = await tx
        .insert(users)
        .values({ organizationId: actor.organizationId, email: parsed.data, displayName: `${e.preferredName ?? e.firstName} ${e.lastName}`, employeeId, status: "invited", isDemo: e.isDemo, createdBy: actor.userId })
        .returning();
    } else if (!u.employeeId) {
      await tx.update(users).set({ employeeId }).where(eq(users.id, u.id));
    }
    const [hasRole] = await tx.select().from(userRoles).where(and(eq(userRoles.userId, u.id), eq(userRoles.roleId, role.id), isNull(userRoles.revokedAt)));
    if (!hasRole) await tx.insert(userRoles).values({ userId: u.id, roleId: role.id, scopeType: "organization", grantedBy: actor.userId });
    await audit(tx, ctx, { action: "employee.invited_to_app", entityType: "employee", entityId: employeeId, facilityId: e.homeFacilityId, after: { userId: u.id } });
    return u.id;
  });
  return { userId, token: await createInvitation(db, userId, actor.userId) };
}

export async function resendInvitation(db: Db, actor: Actor, ctx: AuditContext, userId: string) {
  requireOrgAdmin(actor, "users.manage");
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)));
  if (!u) throw new NotFoundError("User");
  if (u.status !== "invited") throw new AppError("This user has already accepted their invitation.");
  const token = await createInvitation(db, userId, actor.userId);
  await audit(db, ctx, { action: "user.invitation_reissued", entityType: "user", entityId: userId });
  return token;
}

export async function grantRole(db: Db, actor: Actor, ctx: AuditContext, userId: string, roleId: string, scopeType: string, facilityId?: string, departmentId?: string) {
  requireOrgAdmin(actor, "users.manage");
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)));
  const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, actor.organizationId)));
  if (!u || !role) throw new NotFoundError("User or role");
  const scope = await validateScope(db, actor, scopeType, facilityId, departmentId);
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(userRoles).values({ userId, roleId, ...scope, grantedBy: actor.userId }).onConflictDoNothing().returning();
    if (row) await audit(tx, ctx, { action: "user.role_granted", entityType: "user", entityId: userId, facilityId: scope.facilityId, after: { role: role.key, ...scope } });
  });
}

export async function revokeRole(db: Db, actor: Actor, ctx: AuditContext, userRoleId: string) {
  requireOrgAdmin(actor, "users.manage");
  const [g] = await db.select({ grant: userRoles, roleKey: roles.key, orgId: roles.organizationId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.id, userRoleId));
  if (!g || g.orgId !== actor.organizationId) throw new NotFoundError("Role assignment");
  if (g.grant.userId === actor.userId && g.roleKey === "corporate_admin") throw new AppError("You can't remove your own Corporate Admin role.");
  await db.transaction(async (tx) => {
    await tx.update(userRoles).set({ revokedAt: new Date() }).where(eq(userRoles.id, userRoleId));
    await audit(tx, ctx, { action: "user.role_revoked", entityType: "user", entityId: g.grant.userId, facilityId: g.grant.facilityId, before: { role: g.roleKey, scopeType: g.grant.scopeType } });
  });
}

export async function setUserDisabled(db: Db, actor: Actor, ctx: AuditContext, userId: string, disabled: boolean) {
  requireOrgAdmin(actor, "users.manage");
  if (userId === actor.userId) throw new AppError("You can't disable your own account.");
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)));
  if (!u) throw new NotFoundError("User");
  const status = disabled ? "disabled" : u.passwordHash ? "active" : "invited";
  await db.transaction(async (tx) => {
    await tx.update(users).set({ status }).where(eq(users.id, userId));
    await audit(tx, ctx, { action: disabled ? "user.disabled" : "user.enabled", entityType: "user", entityId: userId, before: { status: u.status }, after: { status } });
  });
  if (disabled) await revokeAllSessions(db, userId);
}

export async function listRolesWithPermissions(db: Db, actor: Actor) {
  const roleRows = await db.select().from(roles).where(eq(roles.organizationId, actor.organizationId)).orderBy(asc(roles.name));
  const rp = roleRows.length ? await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleRows.map((r) => r.id))) : [];
  const perms = await db.select().from(permissions).orderBy(asc(permissions.category), asc(permissions.key));
  return {
    roles: roleRows.map((r) => ({ ...r, permissions: new Set(rp.filter((x) => x.roleId === r.id).map((x) => x.permissionKey)) })),
    permissions: perms,
  };
}

export async function setRolePermissions(db: Db, actor: Actor, ctx: AuditContext, roleId: string, perms: string[]) {
  requireOrgAdmin(actor, "roles.manage");
  const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, actor.organizationId)));
  if (!role) throw new NotFoundError("Role");
  const valid = perms.filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
  if (role.key === "corporate_admin" && (!valid.includes("roles.manage") || !valid.includes("users.manage"))) {
    throw new AppError("Corporate Admin must keep 'roles.manage' and 'users.manage' so the organization can't be locked out.");
  }
  if (role.key === "employee" && valid.some((p) => !p.startsWith("self."))) {
    throw new AppError("The Employee role can only have self-service permissions. Give staff access with a separate role.");
  }
  await db.transaction(async (tx) => {
    const before = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((r) => r.permissionKey).sort();
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (valid.length) await tx.insert(rolePermissions).values(valid.map((permissionKey) => ({ roleId, permissionKey })));
    await audit(tx, ctx, { action: "role.permissions_updated", entityType: "role", entityId: roleId, before, after: [...valid].sort() });
  });
}
