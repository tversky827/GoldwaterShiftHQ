import type { Db, Tx } from "@/db";
import { auditLogs } from "@/db/schema";

export interface AuditContext {
  organizationId: string;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "integration";
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  facilityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const SENSITIVE = /password|token|secret|hash/i;

function scrub(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(scrub);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE.test(k) ? "[redacted]" : scrub(x)]));
  }
  return v;
}

/** Only the fields that changed, for compact before/after records. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const x = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const y = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

/** Write an audit record. Call inside the same transaction as the change. */
export async function audit(db: Db | Tx, ctx: AuditContext, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: ctx.organizationId,
    actorType: ctx.actorType ?? (ctx.actorUserId ? "user" : "system"),
    actorUserId: ctx.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    facilityId: entry.facilityId ?? null,
    before: scrub(entry.before) as object | null,
    after: scrub(entry.after) as object | null,
    reason: entry.reason ?? null,
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent?.slice(0, 300) ?? null,
  });
}
