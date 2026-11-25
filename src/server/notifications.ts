/**
 * Notifications.
 *
 * In-app notifications are always written. Email, SMS and push are queued
 * only when (a) a provider is configured for that channel and (b) the user
 * hasn't turned that category/channel off. Delivery happens in a background
 * job (`deliverPending`). No vendor is hard-coded: providers implement the
 * small `NotificationProvider` interface and are registered by environment
 * variable once the owner picks a vendor.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { notificationPreferences, notifications, rolePermissions, userRoles, users } from "@/db/schema";
import { log } from "./log";
import type { Actor } from "./rbac/access";
import type { Permission } from "./rbac/catalog";

export type Channel = "in_app" | "email" | "sms" | "push";
export type ExternalChannel = Exclude<Channel, "in_app">;

export interface NotificationProvider {
  channel: ExternalChannel;
  name: string;
  send(to: { userId: string; email: string; displayName: string }, msg: { title: string; body: string; data: unknown }): Promise<void>;
}

const providers = new Map<ExternalChannel, NotificationProvider>();

/** Logs instead of sending. Enabled with NOTIFY_<CHANNEL>_PROVIDER=log (development only). */
const logProvider = (channel: ExternalChannel): NotificationProvider => ({
  channel,
  name: "log",
  async send(to, msg) {
    log.info("notification.log_provider", { channel, userId: to.userId, title: msg.title });
  },
});

export function registerProvider(p: NotificationProvider) {
  providers.set(p.channel, p);
}
export function clearProviders() {
  providers.clear();
}

function configuredProvider(channel: ExternalChannel): NotificationProvider | undefined {
  const p = providers.get(channel);
  if (p) return p;
  const env = process.env[`NOTIFY_${channel.toUpperCase()}_PROVIDER`];
  if (env === "log" && process.env.APP_ENV !== "production") {
    const lp = logProvider(channel);
    providers.set(channel, lp);
    return lp;
  }
  return undefined;
}

export function configuredChannels(): Channel[] {
  return ["in_app", ...(["email", "sms", "push"] as const).filter((c) => configuredProvider(c))];
}

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  category: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Writes in-app notifications (and queues external ones) for the given users. */
export async function notify(db: Db | Tx, n: NotifyInput): Promise<number> {
  const ids = [...new Set(n.userIds)];
  if (!ids.length) return 0;
  const people = await db.select({ id: users.id, employeeId: users.employeeId }).from(users).where(and(inArray(users.id, ids), eq(users.organizationId, n.organizationId), eq(users.status, "active")));
  if (!people.length) return 0;
  const external = (["email", "sms", "push"] as const).filter((c) => configuredProvider(c));
  const optOut = external.length
    ? await db
        .select()
        .from(notificationPreferences)
        .where(and(inArray(notificationPreferences.userId, people.map((p) => p.id)), eq(notificationPreferences.category, n.category), eq(notificationPreferences.enabled, false)))
    : [];
  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const p of people) {
    const base = { organizationId: n.organizationId, userId: p.id, employeeId: p.employeeId, category: n.category, title: n.title, body: n.body, data: n.data ?? null };
    rows.push({ ...base, channel: "in_app", status: "sent", sentAt: new Date() });
    for (const c of external) if (!optOut.some((o) => o.userId === p.id && o.channel === c)) rows.push({ ...base, channel: c, status: "pending" });
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(notifications).values(rows.slice(i, i + 500));
  return people.length;
}

/** Active users holding `perm` that covers this facility (org-wide or facility-scoped grants). */
export async function usersWithPermission(db: Db | Tx, organizationId: string, perm: Permission, facilityId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        isNull(userRoles.revokedAt),
        eq(rolePermissions.permissionKey, perm),
        or(eq(userRoles.scopeType, "organization"), and(inArray(userRoles.scopeType, ["facility", "department"]), eq(userRoles.facilityId, facilityId))),
      ),
    );
  return rows.map((r) => r.id);
}

/** Active users holding `perm` through a regional-pool grant. */
export async function poolUsersWithPermission(db: Db | Tx, organizationId: string, perm: Permission): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(users.organizationId, organizationId), eq(users.status, "active"), isNull(userRoles.revokedAt), eq(rolePermissions.permissionKey, perm), eq(userRoles.scopeType, "pool")));
  return rows.map((r) => r.id);
}

/** User accounts linked to these employees. */
export async function usersForEmployees(db: Db | Tx, employeeIds: string[]): Promise<string[]> {
  if (!employeeIds.length) return [];
  const rows = await db.select({ id: users.id }).from(users).where(and(inArray(users.employeeId, [...new Set(employeeIds)]), eq(users.status, "active")));
  return rows.map((r) => r.id);
}

/* --------------------------------------------------------------- inbox */

export async function myNotifications(db: Db, actor: Actor, limit = 30) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), eq(notifications.channel, "in_app")))
    .orderBy(sql`${notifications.readAt} is not null`, sql`${notifications.createdAt} desc`)
    .limit(limit);
}

export async function unreadCount(db: Db, actor: Actor) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), eq(notifications.channel, "in_app"), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function markRead(db: Db, actor: Actor, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date(), status: "read" })
    .where(and(eq(notifications.userId, actor.userId), eq(notifications.channel, "in_app"), isNull(notifications.readAt), ids?.length ? inArray(notifications.id, ids) : sql`true`));
}

/* ------------------------------------------------------------- delivery */

/** Sends queued email/SMS/push notifications. Safe to run repeatedly. */
export async function deliverPending(db: Db, limit = 200) {
  const pending = await db
    .select({ n: notifications, email: users.email, displayName: users.displayName })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(eq(notifications.status, "pending"), inArray(notifications.channel, ["email", "sms", "push"])))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const { n, email, displayName } of pending) {
    const p = configuredProvider(n.channel as ExternalChannel);
    if (!p) continue; // provider removed since queuing; leave pending
    try {
      await p.send({ userId: n.userId!, email, displayName }, { title: n.title, body: n.body, data: n.data });
      await db.update(notifications).set({ status: "sent", sentAt: new Date() }).where(eq(notifications.id, n.id));
      sent++;
    } catch (e) {
      await db.update(notifications).set({ status: "failed", failureReason: String((e as Error)?.message ?? e).slice(0, 300) }).where(eq(notifications.id, n.id));
      failed++;
    }
  }
  return { sent, failed };
}
