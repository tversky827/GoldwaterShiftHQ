/**
 * Base data every organization needs: the permission catalog and default roles.
 * Safe to run repeatedly. Existing role customizations are never overwritten.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { DEFAULT_ROLES, PERMISSIONS } from "@/server/rbac/catalog";

export async function seedPermissionCatalog(db: Db) {
  for (const [key, [category, description]] of Object.entries(PERMISSIONS)) {
    await db.insert(permissions).values({ key, category, description }).onConflictDoUpdate({ target: permissions.key, set: { category, description } });
  }
}

export async function seedDefaultRoles(db: Db, organizationId: string) {
  await seedPermissionCatalog(db);
  const out: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) {
    const [existing] = await db.select().from(roles).where(and(eq(roles.organizationId, organizationId), eq(roles.key, r.key)));
    if (existing) {
      out[r.key] = existing.id;
      continue;
    }
    const [created] = await db
      .insert(roles)
      .values({ organizationId, key: r.key, name: r.name, description: r.description, defaultScope: r.defaultScope, isSystem: true })
      .returning();
    if (r.permissions.length) await db.insert(rolePermissions).values(r.permissions.map((permissionKey) => ({ roleId: created.id, permissionKey })));
    out[r.key] = created.id;
  }
  return out;
}
