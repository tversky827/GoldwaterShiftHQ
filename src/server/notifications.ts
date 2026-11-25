/**
 * Notifications.
 *
 * In-app notifications are always written. Email and text messages are queued
 * only when a provider is configured (see notify-providers.ts) and the person
 * hasn't turned that channel off. Texts additionally need a mobile number and
 * the person's recorded consent, and are used only for time-sensitive
 * categories. Delivery happens in `deliverPending` (background job), which
 * claims each message before sending so it is never sent twice.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { notificationPreferences, notifications, organizations, rolePermissions, userRoles, users } from "@/db/schema";
import { audit, type AuditContext } from "./audit";
import { AppError } from "./errors";
import { appBaseUrl } from "./integrations/config";
import { log } from "./log";
import { providerFromEnv, type ExternalChannel, type NotificationProvider } from "./notify-providers";
import type { Actor } from "./rbac/access";
import type { Permission } from "./rbac/catalog";

export type Channel = "in_app" | ExternalChannel;
export type { ExternalChannel, NotificationProvider };

/** Categories worth a text message (time-sensitive). Everything else is in-app and email only. */
export const SMS_CATEGORIES = new Set(["callout_coverage", "callout", "waitlist_offer", "claim_decided", "swap_request", "swap_update", "pool_assignment"]);
/** Preference rows with this category apply to every category of a channel. */
export const ALL_CATEGORIES = "all";

const providers = new Map<ExternalChannel, NotificationProvider>();

export function registerProvider(p: NotificationProvider) {
  providers.set(p.channel, p);
}
export function clearProviders() {
  providers.clear();
}

function configuredProvider(channel: ExternalChannel): NotificationProvider | undefined {
  const p = providers.get(channel);
  if (p) return p;
  const fromEnv = providerFromEnv(channel);
  if (fromEnv) providers.set(channel, fromEnv);
  return fromEnv;
}

export function configuredChannels(): Channel[] {
  return ["in_app", ...(["email", "sms"] as const).filter((c) => configuredProvider(c))];
}

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  category: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Writes in-app notifications (and queues email/texts) for the given users. */
export async function notify(db: Db | Tx, n: NotifyInput): Promise<number> {
  const ids = [...new Set(n.userIds)];
  if (!ids.length) return 0;
  const people = await db
    .select({ id: users.id, employeeId: users.employeeId, mobilePhone: users.mobilePhone, smsConsentAt: users.smsConsentAt })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.organizationId, n.organizationId), eq(users.status, "active")));
  if (!people.length) return 0;
  const external = (["email", "sms"] as const).filter((c) => configuredProvider(c) && (c !== "sms" || SMS_CATEGORIES.has(n.category)));
  const optOut = external.length
    ? await db
        .select()
        .from(notificationPreferences)
        .where(and(inArray(notificationPreferences.userId, people.map((p) => p.id)), inArray(notificationPreferences.category, [n.category, ALL_CATEGORIES]), eq(notificationPreferences.enabled, false)))
    : [];
  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const p of people) {
    const base = { organizationId: n.organizationId, userId: p.id, employeeId: p.employeeId, category: n.category, title: n.title, body: n.body, data: n.data ?? null };
    rows.push({ ...base, channel: "in_app", status: "sent", sentAt: new Date() });
    for (const c of external) {
      if (optOut.some((o) => o.userId === p.id && o.channel === c)) continue;
      if (c === "sms" && !(p.mobilePhone && p.smsConsentAt)) continue;
      rows.push({ ...base, channel: c, status: "pending" });
    }
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

/** Where a notification should take the person in the app. */
function linkFor(n: { category: string; userId: string | null }, isEmployee: boolean) {
  const base = appBaseUrl();
  if (["claim_review", "swap_review", "callout", "approval_requested"].includes(n.category)) return `${base}/open-shifts`;
  if (n.category === "pool_placement") return `${base}/schedule`;
  if (n.category === "pool_assignment") return `${base}/app/schedule`;
  if (["open_shift", "callout_coverage", "waitlist_offer"].includes(n.category)) return `${base}/app/shifts`;
  return `${base}${isEmployee ? "/app" : "/overview"}`;
}

/**
 * Sends queued email/texts. Safe to run repeatedly and from several servers at
 * once: each message is claimed (pending -> sent) before it is handed to the
 * provider, and marked failed if the provider refuses it.
 */
export async function deliverPending(db: Db, limit = 200) {
  // Claim a batch atomically. `for update skip locked` lets several servers
  // claim different rows at once, and re-checking status = 'pending' in the
  // outer update means a row another server just claimed is never taken twice.
  const claimed = await db
    .update(notifications)
    .set({ status: "sent", sentAt: new Date() })
    .where(
      and(
        eq(notifications.status, "pending"),
        inArray(
          notifications.id,
          db
            .select({ id: notifications.id })
            .from(notifications)
            .where(and(eq(notifications.status, "pending"), inArray(notifications.channel, ["email", "sms", "push"])))
            .orderBy(asc(notifications.createdAt))
            .limit(limit)
            .for("update", { skipLocked: true }),
        ),
      ),
    )
    .returning();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const n of claimed) {
    const p = configuredProvider(n.channel as ExternalChannel);
    if (!p) {
      // Provider removed since queuing: put it back for later.
      await db.update(notifications).set({ status: "pending", sentAt: null }).where(eq(notifications.id, n.id));
      skipped++;
      continue;
    }
    const [u] = await db.select({ email: users.email, displayName: users.displayName, mobilePhone: users.mobilePhone, smsConsentAt: users.smsConsentAt, employeeId: users.employeeId }).from(users).where(eq(users.id, n.userId!));
    try {
      if (!u) throw new Error("User not found.");
      if (n.channel === "sms" && !(u.mobilePhone && u.smsConsentAt)) throw new Error("Text messages were turned off for this person.");
      await p.send({ userId: n.userId!, email: u.email, displayName: u.displayName, mobilePhone: u.mobilePhone }, { title: n.title, body: n.body, link: linkFor(n, !!u.employeeId) });
      sent++;
    } catch (e) {
      await db.update(notifications).set({ status: "failed", failureReason: String((e as Error)?.message ?? e).slice(0, 300) }).where(eq(notifications.id, n.id));
      log.warn("notification.delivery_failed", { channel: n.channel, provider: p.name, notificationId: n.id });
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/* ------------------------------------------------- personal preferences */

export interface MyNotificationSettings {
  email: string;
  emailEnabled: boolean;
  mobilePhone: string | null;
  smsEnabled: boolean;
  channelsAvailable: { email: boolean; sms: boolean };
  organizationName: string;
}

export async function myNotificationSettings(db: Db, actor: Actor): Promise<MyNotificationSettings> {
  const [u] = await db.select().from(users).where(eq(users.id, actor.userId));
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.organizationId));
  const prefs = await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.userId, actor.userId), eq(notificationPreferences.category, ALL_CATEGORIES)));
  const off = (c: string) => prefs.some((p) => p.channel === c && !p.enabled);
  return {
    email: u.email,
    emailEnabled: !off("email"),
    mobilePhone: u.mobilePhone,
    smsEnabled: !!(u.mobilePhone && u.smsConsentAt) && !off("sms"),
    channelsAvailable: { email: !!configuredProvider("email"), sms: !!configuredProvider("sms") },
    organizationName: org?.name ?? "your employer",
  };
}

/** US numbers typed any common way -> E.164; other countries need a leading +. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const digits = t.replace(/[^\d]/g, "");
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function saveMyNotificationSettings(db: Db, actor: Actor, ctx: AuditContext, input: { emailEnabled: boolean; smsEnabled: boolean; mobilePhone: string }) {
  const phone = normalizePhone(input.mobilePhone);
  if (input.mobilePhone.trim() && !phone) throw new AppError("Enter a mobile number like (555) 555-0123.");
  if (input.smsEnabled && !phone) throw new AppError("Add your mobile number to get text messages.");
  const [u] = await db.select().from(users).where(eq(users.id, actor.userId));
  await db.transaction(async (tx) => {
    const consentChanged = input.smsEnabled !== !!u.smsConsentAt || phone !== u.mobilePhone;
    await tx.update(users).set({ mobilePhone: phone, smsConsentAt: input.smsEnabled ? (u.smsConsentAt && phone === u.mobilePhone ? u.smsConsentAt : new Date()) : null }).where(eq(users.id, actor.userId));
    for (const [channel, enabled] of [["email", input.emailEnabled], ["sms", input.smsEnabled]] as const) {
      await tx
        .insert(notificationPreferences)
        .values({ userId: actor.userId, category: ALL_CATEGORIES, channel, enabled })
        .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.category, notificationPreferences.channel], set: { enabled } });
    }
    // Consent to texts is recorded in the audit log (who, when, which number's last digits).
    await audit(tx, ctx, { action: "user.notification_settings_updated", entityType: "user", entityId: actor.userId, after: { emailEnabled: input.emailEnabled, smsEnabled: input.smsEnabled, phoneLast4: phone?.slice(-4) ?? null, smsConsent: consentChanged ? (input.smsEnabled ? "given" : "withdrawn") : "unchanged" } });
  });
}
