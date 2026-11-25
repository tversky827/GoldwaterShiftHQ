/**
 * Background marketplace job. Safe to run as often as you like (every 5-10
 * minutes is typical); every step is idempotent.
 *   1. scheduled listings whose publish time has come -> open (+ notify)
 *   2. listings past their closing time, or whose shift started -> expired
 *   3. automatic publishing per Settings -> Marketplace
 *   4. callout escalation
 *   5. delivery of queued email / SMS / push notifications
 */
import { and, eq, gt, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { facilities, marketplaceListings, organizations, schedules, shiftAssignments, shiftClaims, shifts } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { log } from "../log";
import { deliverPending, notify, usersForEmployees } from "../notifications";
import { escalateCallouts } from "./callouts";
import { marketplaceConfig } from "./settings";
import { announceListings, formatShift } from "./state";

export async function runMarketplaceJobs(db: Db, now = new Date()) {
  const out = { opened: 0, expired: 0, autoPublished: 0, callouts: { escalated: 0, covered: 0, uncovered: 0 }, delivered: { sent: 0, failed: 0, skipped: 0 }, errors: [] as string[] };
  // Each step is isolated: one failing step is logged and reported, and the others still run.
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      out.errors.push(name);
      log.error("jobs.step_failed", { step: name, message: (e as Error)?.message?.slice(0, 300) });
    }
  };
  await step("open_scheduled", () => openScheduled(db, now, out));
  await step("expire", () => expireListings(db, now, out));
  await step("auto_publish", () => autoPublish(db, now, out));
  await step("callouts", async () => {
    out.callouts = await escalateCallouts(db, now);
  });
  // External notification delivery (no-op until a provider is configured)
  await step("deliver", async () => {
    out.delivered = await deliverPending(db);
  });
  return out;
}

type JobOut = Awaited<ReturnType<typeof runMarketplaceJobs>>;

async function openScheduled(db: Db, now: Date, out: JobOut) {

  // 1. Scheduled -> open
  const due = await db
    .update(marketplaceListings)
    .set({ status: "open" })
    .where(and(eq(marketplaceListings.status, "scheduled"), lte(marketplaceListings.publishAt, now)))
    .returning({ id: marketplaceListings.id, facilityId: marketplaceListings.facilityId });
  out.opened = due.length;
  const byOrg = new Map<string, string[]>();
  if (due.length) {
    const facs = await db.select({ id: facilities.id, org: facilities.organizationId }).from(facilities).where(inArray(facilities.id, [...new Set(due.map((d) => d.facilityId))]));
    for (const d of due) {
      const org = facs.find((f) => f.id === d.facilityId)!.org;
      byOrg.set(org, [...(byOrg.get(org) ?? []), d.id]);
      await audit(db, { organizationId: org, actorType: "system" }, { action: "listing.opened", entityType: "marketplace_listing", entityId: d.id, facilityId: d.facilityId });
    }
    for (const [org, ids] of byOrg) await announceListings(db, org, ids);
  }
}

async function expireListings(db: Db, now: Date, out: JobOut) {
  // 2. Expire
  const stale = await db
    .select({ id: marketplaceListings.id, facilityId: marketplaceListings.facilityId, org: facilities.organizationId, startsAt: shifts.startsAt, tz: facilities.timezone, facilityName: facilities.name })
    .from(marketplaceListings)
    .innerJoin(shifts, eq(shifts.id, marketplaceListings.shiftId))
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .where(and(inArray(marketplaceListings.status, ["scheduled", "open"]), or(and(isNotNull(marketplaceListings.expiresAt), lte(marketplaceListings.expiresAt, now)), lte(shifts.startsAt, now))));
  for (const l of stale) {
    await db.transaction(async (tx) => {
      const won = await tx.update(marketplaceListings).set({ status: "expired" }).where(and(eq(marketplaceListings.id, l.id), inArray(marketplaceListings.status, ["scheduled", "open"]))).returning({ id: marketplaceListings.id });
      if (!won.length) return; // another server already closed it
      const cancelled = await tx
        .update(shiftClaims)
        .set({ status: "cancelled", decidedAt: now, decisionReason: "The open shift closed before a decision was made." })
        .where(and(eq(shiftClaims.listingId, l.id), eq(shiftClaims.status, "pending")))
        .returning({ employeeId: shiftClaims.employeeId });
      if (cancelled.length) await notify(tx, { organizationId: l.org, userIds: await usersForEmployees(tx, cancelled.map((c) => c.employeeId)), category: "claim_decided", title: "Open shift closed", body: `The shift at ${l.facilityName} on ${formatShift(l.startsAt, l.tz)} closed before your request was reviewed.`, data: { listingId: l.id } });
      await audit(tx, { organizationId: l.org, actorType: "system" }, { action: "listing.expired", entityType: "marketplace_listing", entityId: l.id, facilityId: l.facilityId, after: { claimsCancelled: cancelled.length } });
    });
  }
  out.expired = stale.length;
}

async function autoPublish(db: Db, now: Date, out: JobOut) {
  // 3. Automatic publishing
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const o of orgs) {
    const facs = await db.select().from(facilities).where(and(eq(facilities.organizationId, o.id), eq(facilities.isActive, true)));
    const created: string[] = [];
    for (const f of facs) {
      const cfg = await marketplaceConfig(db, o.id, f.id);
      if (!cfg.autoPublish) continue;
      const horizon = new Date(now.getTime() + cfg.autoPublishHoursBefore * 3_600_000);
      // Unfilled shifts of PUBLISHED schedules that were never listed (a withdrawn or expired listing is respected).
      const candidates = await db
        .select({ shift: shifts, filled: sql<number>`(select count(*)::int from ${shiftAssignments} sa where sa.shift_id = ${shifts.id} and sa.status = 'assigned')` })
        .from(shifts)
        .innerJoin(schedules, eq(schedules.id, shifts.scheduleId))
        .where(and(eq(shifts.facilityId, f.id), eq(shifts.status, "active"), eq(schedules.status, "published"), gt(shifts.startsAt, now), lt(shifts.startsAt, horizon), sql`not exists (select 1 from ${marketplaceListings} ml where ml.shift_id = ${shifts.id})`))
        .limit(500);
      const ctx: AuditContext = { organizationId: o.id, actorType: "system" };
      for (const c of candidates) {
        const open = c.shift.requiredCount - c.filled;
        if (open <= 0) continue;
        let expiresAt = new Date(c.shift.startsAt.getTime() - cfg.expiryHoursBefore * 3_600_000);
        if (expiresAt <= now) expiresAt = c.shift.startsAt;
        const [l] = await db
          .insert(marketplaceListings)
          .values({ shiftId: c.shift.id, facilityId: f.id, openings: open, status: "open", publishAt: now, expiresAt, requiresApproval: cfg.requireApproval, audience: { scope: "authorized" } })
          .onConflictDoNothing()
          .returning({ id: marketplaceListings.id });
        if (!l) continue;
        await audit(db, ctx, { action: "listing.auto_published", entityType: "marketplace_listing", entityId: l.id, facilityId: f.id, after: { shiftId: c.shift.id, openings: open, expiresAt } });
        created.push(l.id);
      }
    }
    if (created.length) await announceListings(db, o.id, created);
    out.autoPublished += created.length;
  }
}
