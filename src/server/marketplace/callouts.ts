/**
 * Callouts ("I can't make it") with automatic escalation.
 *
 *   recorded  -> assignment marked "called_out"; the shift is listed at once
 *                (urgent) for the facility's own qualified staff; managers told.
 *   level 1   -> after N minutes uncovered: widened to staff authorized from
 *                other facilities and the regional pool.
 *   level 2   -> after M more minutes: leadership (assignment approvers) alerted.
 *   covered   -> someone picks it up (set by refreshShiftMarket).
 *   uncovered -> the shift starts with nobody; managers told.
 * N and M come from Settings -> Marketplace (defaults 30 and 60 minutes).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { callouts, employees, marketplaceListings, shiftAssignments } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { notify, usersWithPermission } from "../notifications";
import { can, type Actor } from "../rbac/access";
import { withFriendlyDbErrors } from "../scheduling/assignments";
import { marketplaceConfig } from "./settings";
import { announceListings, eligibleUserIds, filledCount, formatShift, LIVE, refreshShiftMarket, shiftContext } from "./state";

export async function recordCallout(db: Db, actor: Actor, ctx: AuditContext, assignmentId: string, reason: string, now = new Date()) {
  const [a] = await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, assignmentId));
  if (!a) throw new NotFoundError("Shift");
  const sc = await shiftContext(db, a.shiftId);
  if (!sc || sc.facility.organizationId !== actor.organizationId) throw new NotFoundError("Shift");
  const self = actor.employeeId === a.employeeId && can(actor, "self.schedule");
  if (!self && !can(actor, "callouts.manage", { facilityId: a.facilityId, departmentId: sc.shift.departmentId ?? undefined })) throw new ForbiddenError();
  if (a.status !== "assigned") throw new AppError("This shift is no longer assigned.");
  if (a.endsAt <= now) throw new AppError("This shift has already ended.");
  const why = reason.trim().slice(0, 300);
  if (!self && why.length < 3) throw new AppError("Add a short reason for the callout.");
  const [emp] = await db.select({ first: employees.firstName, last: employees.lastName }).from(employees).where(eq(employees.id, a.employeeId));
  const cfg = await marketplaceConfig(db, actor.organizationId, a.facilityId);
  const when = formatShift(sc.shift.startsAt, sc.facility.timezone);

  return withFriendlyDbErrors(db, async (tx) => {
    await tx.update(shiftAssignments).set({ status: "called_out", cancelledAt: now, cancelledBy: actor.userId, cancelReason: `Called out${why ? `: ${why}` : ""}` }).where(eq(shiftAssignments.id, assignmentId));
    let [listing] = await tx.select().from(marketplaceListings).where(and(eq(marketplaceListings.shiftId, a.shiftId), inArray(marketplaceListings.status, LIVE)));
    let created = false;
    if (sc.shift.startsAt > now) {
      if (listing) {
        // Make sure the urgent opening is visible now and until the shift starts.
        await tx.update(marketplaceListings).set({ status: "open", publishAt: now, expiresAt: sc.shift.startsAt, openings: sc.shift.requiredCount - (await filledCount(tx, a.shiftId)) }).where(eq(marketplaceListings.id, listing.id));
      } else {
        [listing] = await tx
          .insert(marketplaceListings)
          .values({ shiftId: a.shiftId, facilityId: a.facilityId, openings: Math.max(1, sc.shift.requiredCount - (await filledCount(tx, a.shiftId))), status: "open", publishAt: now, expiresAt: sc.shift.startsAt, requiresApproval: cfg.requireApproval, audience: { scope: "home" }, publishedBy: actor.userId })
          .returning();
        created = true;
      }
    }
    const [co] = await tx.insert(callouts).values({ assignmentId, shiftId: a.shiftId, facilityId: a.facilityId, reportedBy: actor.userId, reason: why || null, listingId: listing?.id ?? null, status: sc.shift.startsAt > now ? "open" : "uncovered", resolvedAt: sc.shift.startsAt > now ? null : now }).returning({ id: callouts.id });
    await audit(tx, ctx, { action: "callout.recorded", entityType: "callout", entityId: co.id, facilityId: a.facilityId, after: { assignmentId, employeeId: a.employeeId, listingId: listing?.id ?? null, listingCreated: created, selfReported: self }, reason: why || null });
    await refreshShiftMarket(tx, ctx, a.shiftId, now);
    const managers = await usersWithPermission(tx, actor.organizationId, "callouts.manage", a.facilityId);
    await notify(tx, { organizationId: actor.organizationId, userIds: managers.filter((u) => u !== actor.userId), category: "callout", title: "Callout", body: `${emp?.first} ${emp?.last} called out of ${sc.positionCode} on ${when}.${listing ? " The shift is posted for pick-up." : ""}`, data: { calloutId: co.id, facilityId: a.facilityId } });
    let notified = 0;
    if (listing) notified = await announceListings(tx, actor.organizationId, [listing.id], { urgent: true, scopeOverride: "home" });
    return { calloutId: co.id, listingId: listing?.id ?? null, notified };
  });
}

/** Escalates or closes open callouts. Called by the marketplace job. */
export async function escalateCallouts(db: Db, now = new Date()) {
  const open = await db.select().from(callouts).where(eq(callouts.status, "open"));
  const stats = { escalated: 0, covered: 0, uncovered: 0 };
  for (const co of open) {
    if (!co.shiftId || !co.facilityId) continue;
    const sc = await shiftContext(db, co.shiftId);
    if (!sc) continue;
    const orgId = sc.facility.organizationId;
    const ctx: AuditContext = { organizationId: orgId, actorType: "system" };
    const when = formatShift(sc.shift.startsAt, sc.facility.timezone);
    if ((await filledCount(db, co.shiftId)) >= sc.shift.requiredCount) {
      await db.update(callouts).set({ status: "covered", resolvedAt: now }).where(eq(callouts.id, co.id));
      stats.covered++;
      continue;
    }
    if (sc.shift.startsAt <= now) {
      await db.transaction(async (tx) => {
        await tx.update(callouts).set({ status: "uncovered", resolvedAt: now }).where(eq(callouts.id, co.id));
        await audit(tx, ctx, { action: "callout.uncovered", entityType: "callout", entityId: co.id, facilityId: co.facilityId });
        await notify(tx, { organizationId: orgId, userIds: await usersWithPermission(tx, orgId, "callouts.manage", co.facilityId!), category: "callout", title: "Shift started uncovered", body: `${sc.positionCode} on ${when} started without coverage.`, data: { calloutId: co.id } });
      });
      stats.uncovered++;
      continue;
    }
    if (co.escalationLevel >= 2) continue;
    const cfg = await marketplaceConfig(db, orgId, co.facilityId);
    const waitMin = cfg.escalationMinutes[co.escalationLevel] ?? 30;
    const since = co.escalatedAt ?? co.createdAt;
    if (now.getTime() - since.getTime() < waitMin * 60_000) continue;
    const level = co.escalationLevel + 1;
    await db.transaction(async (tx) => {
      await tx.update(callouts).set({ escalationLevel: level, escalatedAt: now }).where(eq(callouts.id, co.id));
      if (level === 1 && co.listingId) {
        await tx.update(marketplaceListings).set({ audience: { scope: "authorized" } }).where(eq(marketplaceListings.id, co.listingId));
        const homeUsers = await eligibleUserIds(tx, orgId, co.facilityId!, sc.shift.positionId, "home");
        await announceListings(tx, orgId, [co.listingId], { urgent: true, scopeOverride: "authorized", excludeUserIds: homeUsers });
      }
      if (level === 2) {
        const leaders = [...new Set([...(await usersWithPermission(tx, orgId, "assignments.approve", co.facilityId!)), ...(await usersWithPermission(tx, orgId, "callouts.manage", co.facilityId!))])];
        await notify(tx, { organizationId: orgId, userIds: leaders, category: "callout", title: "Callout still uncovered", body: `${sc.positionCode} at ${sc.facility.name} on ${when} is still open after ${cfg.escalationMinutes.reduce((s, m) => s + m, 0)} minutes.`, data: { calloutId: co.id } });
      }
      await audit(tx, ctx, { action: "callout.escalated", entityType: "callout", entityId: co.id, facilityId: co.facilityId, after: { level } });
    });
    stats.escalated++;
  }
  return stats;
}
