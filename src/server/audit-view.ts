import { and, desc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLogs, facilities, users } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { facilityScope, type Actor } from "./rbac/access";

/** Audit entries the actor may see: org-wide for corporate, else entries for their facilities. */
export async function listAudit(db: Db, actor: Actor, f: { action?: string; entityType?: string; limit?: number } = {}) {
  const scope = facilityScope(actor, "audit.view");
  if (scope !== "all" && !scope.length) throw new ForbiddenError();
  const where: SQL[] = [eq(auditLogs.organizationId, actor.organizationId)];
  if (scope !== "all") where.push(inArray(auditLogs.facilityId, scope));
  if (f.action) where.push(ilike(auditLogs.action, `${f.action.replace(/[%_]/g, "")}%`));
  if (f.entityType) where.push(eq(auditLogs.entityType, f.entityType));
  return db
    .select({ log: auditLogs, actorName: users.displayName, facilityName: facilities.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(facilities, eq(facilities.id, auditLogs.facilityId))
    .where(and(...where))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(f.limit ?? 100, 500));
}
