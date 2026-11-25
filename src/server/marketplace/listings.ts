/**
 * Publishing open shifts to the marketplace (staff side).
 *
 * single / bulk   publishOpenShifts([...shiftIds])
 * scheduled       publishAt in the future -> status "scheduled", opened by the job
 * automatic       runMarketplaceJobs auto-publishes per Settings -> Marketplace
 * expiring        expiresAt (default: N hours before the shift, from settings)
 * withdraw        withdrawListing (pending claims are cancelled and told why)
 */
import { and, asc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { callouts, departments, employees, facilities, marketplaceListings, positions, shiftAssignments, shiftClaims, shifts, shiftSwapRequests, shiftWaitlists, users } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { notify, usersForEmployees } from "../notifications";
import { assertCan, can, type Actor } from "../rbac/access";
import { marketplaceConfig } from "./settings";
import { announceListings, formatShift, LIVE, type AudienceScope } from "./state";

export interface PublishInput {
  shiftIds: string[];
  /** Omit (or a past time) to publish now. */
  publishAt?: Date | null;
  /** Hours before the shift starts that the listing closes. Omit for the facility default. */
  expiryHoursBefore?: number | null;
  requiresApproval?: boolean | null;
  audience?: AudienceScope;
  incentiveText?: string | null;
}

export interface PublishResult {
  published: number;
  scheduled: number;
  listingIds: string[];
  skipped: { shiftId: string; reason: string }[];
  notified: number;
}

export async function publishOpenShifts(db: Db, actor: Actor, ctx: AuditContext, input: PublishInput, now = new Date()): Promise<PublishResult> {
  const ids = [...new Set(input.shiftIds)].slice(0, 300);
  if (!ids.length) throw new AppError("Choose at least one shift to publish.");
  const incentive = input.incentiveText?.trim().slice(0, 140) || null;
  const rows = await db
    .select({ shift: shifts, facility: facilities, filled: sql<number>`(select count(*)::int from ${shiftAssignments} sa where sa.shift_id = ${shifts.id} and sa.status = 'assigned')` })
    .from(shifts)
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .where(inArray(shifts.id, ids));
  const live = await db.select({ shiftId: marketplaceListings.shiftId }).from(marketplaceListings).where(and(inArray(marketplaceListings.shiftId, ids), inArray(marketplaceListings.status, LIVE)));
  const liveSet = new Set(live.map((l) => l.shiftId));
  const result: PublishResult = { published: 0, scheduled: 0, listingIds: [], skipped: [], notified: 0 };
  const configs = new Map<string, Awaited<ReturnType<typeof marketplaceConfig>>>();
  const publishAt = input.publishAt && input.publishAt > now ? input.publishAt : now;

  await db.transaction(async (tx) => {
    for (const id of ids) {
      const r = rows.find((x) => x.shift.id === id);
      if (!r || r.facility.organizationId !== actor.organizationId) {
        result.skipped.push({ shiftId: id, reason: "Shift not found." });
        continue;
      }
      assertCan(actor, "marketplace.manage", { facilityId: r.facility.id, departmentId: r.shift.departmentId ?? undefined });
      const open = r.shift.requiredCount - r.filled;
      const skip = (reason: string) => result.skipped.push({ shiftId: id, reason });
      if (r.shift.status !== "active") skip("The shift was cancelled.");
      else if (r.shift.startsAt <= now) skip("The shift has already started.");
      else if (open <= 0) skip("The shift is already fully staffed.");
      else if (liveSet.has(id)) skip("The shift is already listed.");
      else {
        if (!configs.has(r.facility.id)) configs.set(r.facility.id, await marketplaceConfig(tx, actor.organizationId, r.facility.id));
        const cfg = configs.get(r.facility.id)!;
        const hours = input.expiryHoursBefore ?? cfg.expiryHoursBefore;
        if (!(hours >= 0 && hours <= 72)) throw new AppError("Closing time must be 0 to 72 hours before the shift.");
        let expiresAt = new Date(r.shift.startsAt.getTime() - hours * 3_600_000);
        if (expiresAt <= publishAt) expiresAt = r.shift.startsAt;
        const status = publishAt > now ? "scheduled" : "open";
        const [l] = await tx
          .insert(marketplaceListings)
          .values({
            shiftId: id,
            facilityId: r.facility.id,
            openings: open,
            status,
            publishAt,
            expiresAt,
            requiresApproval: input.requiresApproval ?? cfg.requireApproval,
            incentiveText: incentive,
            audience: { scope: input.audience ?? "authorized" },
            publishedBy: actor.userId,
          })
          .returning({ id: marketplaceListings.id });
        await audit(tx, ctx, { action: status === "open" ? "listing.published" : "listing.scheduled", entityType: "marketplace_listing", entityId: l.id, facilityId: r.facility.id, after: { shiftId: id, openings: open, publishAt, expiresAt, audience: input.audience ?? "authorized", requiresApproval: input.requiresApproval ?? cfg.requireApproval } });
        result.listingIds.push(l.id);
        if (status === "open") result.published++;
        else result.scheduled++;
        liveSet.add(id);
      }
    }
    if (result.published) result.notified = await announceListings(tx, actor.organizationId, result.listingIds);
  });
  return result;
}

export async function withdrawListing(db: Db, actor: Actor, ctx: AuditContext, listingId: string, reason?: string) {
  const [l] = await db.select({ listing: marketplaceListings, shift: shifts, facility: facilities }).from(marketplaceListings).innerJoin(shifts, eq(shifts.id, marketplaceListings.shiftId)).innerJoin(facilities, eq(facilities.id, shifts.facilityId)).where(eq(marketplaceListings.id, listingId));
  if (!l || l.facility.organizationId !== actor.organizationId) throw new NotFoundError("Listing");
  assertCan(actor, "marketplace.manage", { facilityId: l.facility.id, departmentId: l.shift.departmentId ?? undefined });
  if (!LIVE.includes(l.listing.status as "open")) throw new AppError("Only open or scheduled listings can be withdrawn.");
  await db.transaction(async (tx) => {
    await tx.update(marketplaceListings).set({ status: "withdrawn", withdrawnBy: actor.userId, withdrawnAt: new Date() }).where(eq(marketplaceListings.id, listingId));
    const cancelled = await tx
      .update(shiftClaims)
      .set({ status: "cancelled", decidedBy: actor.userId, decidedAt: new Date(), decisionReason: "The open shift was withdrawn." })
      .where(and(eq(shiftClaims.listingId, listingId), eq(shiftClaims.status, "pending")))
      .returning({ employeeId: shiftClaims.employeeId });
    await tx.update(shiftWaitlists).set({ status: "removed" }).where(and(eq(shiftWaitlists.shiftId, l.shift.id), inArray(shiftWaitlists.status, ["waiting", "offered"])));
    if (cancelled.length) {
      await notify(tx, { organizationId: actor.organizationId, userIds: await usersForEmployees(tx, cancelled.map((c) => c.employeeId)), category: "claim_decided", title: "Open shift withdrawn", body: `The shift at ${l.facility.name} on ${formatShift(l.shift.startsAt, l.facility.timezone)} is no longer available.`, data: { listingId } });
    }
    await audit(tx, ctx, { action: "listing.withdrawn", entityType: "marketplace_listing", entityId: listingId, facilityId: l.facility.id, after: { claimsCancelled: cancelled.length }, reason: reason?.trim() || null });
  });
}

/* ------------------------------------------------------------- staff views */

/** Upcoming shifts at a facility with open slots, and whether each is listed. */
export async function unfilledShifts(db: Db, actor: Actor, facilityId: string, days = 14, now = new Date()) {
  if (!can(actor, "schedules.view", { facilityId })) return [];
  const until = new Date(now.getTime() + days * 86_400_000);
  const rows = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      requiredCount: shifts.requiredCount,
      departmentId: shifts.departmentId,
      departmentName: departments.name,
      positionCode: positions.code,
      positionName: positions.name,
      filled: sql<number>`(select count(*)::int from ${shiftAssignments} sa where sa.shift_id = ${shifts.id} and sa.status = 'assigned')`,
      listing: sql<string | null>`(select ml.status::text from ${marketplaceListings} ml where ml.shift_id = ${shifts.id} and ml.status in ('scheduled','open') limit 1)`,
    })
    .from(shifts)
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .leftJoin(departments, eq(departments.id, shifts.departmentId))
    .where(and(eq(shifts.facilityId, facilityId), eq(shifts.status, "active"), gt(shifts.startsAt, now), lt(shifts.startsAt, until)))
    .orderBy(asc(shifts.startsAt), asc(positions.code));
  return rows.filter((r) => r.filled < r.requiredCount).map((r) => ({ ...r, open: r.requiredCount - r.filled }));
}

/** Everything the "Open shifts" page shows for one facility. */
export async function facilityMarketplace(db: Db, actor: Actor, facilityId: string, now = new Date()) {
  assertCan(actor, "schedules.view", { facilityId });
  const since = new Date(now.getTime() - 3 * 86_400_000);
  const listings = await db
    .select({
      listing: marketplaceListings,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      requiredCount: shifts.requiredCount,
      positionCode: positions.code,
      positionName: positions.name,
      filled: sql<number>`(select count(*)::int from ${shiftAssignments} sa where sa.shift_id = ${shifts.id} and sa.status = 'assigned')`,
      pendingClaims: sql<number>`(select count(*)::int from ${shiftClaims} c where c.listing_id = ${marketplaceListings.id} and c.status = 'pending')`,
      waitlist: sql<number>`(select count(*)::int from ${shiftWaitlists} w where w.shift_id = ${shifts.id} and w.status in ('waiting','offered'))`,
      isCallout: sql<boolean>`exists (select 1 from ${callouts} co where co.listing_id = ${marketplaceListings.id})`,
    })
    .from(marketplaceListings)
    .innerJoin(shifts, eq(shifts.id, marketplaceListings.shiftId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(and(eq(marketplaceListings.facilityId, facilityId), sql`(${marketplaceListings.status} in ('scheduled','open') or (${marketplaceListings.updatedAt} >= ${since} and ${shifts.startsAt} >= ${since}))`))
    .orderBy(sql`${marketplaceListings.status} in ('scheduled','open') desc`, asc(shifts.startsAt))
    .limit(200);

  const claims = can(actor, "claims.review", { facilityId })
    ? await db
        .select({ claim: shiftClaims, first: employees.firstName, last: employees.lastName, isPool: employees.isRegionalPool, homeFacilityId: employees.homeFacilityId, startsAt: shifts.startsAt, endsAt: shifts.endsAt, positionCode: positions.code, requiresApproval: marketplaceListings.requiresApproval })
        .from(shiftClaims)
        .innerJoin(marketplaceListings, eq(marketplaceListings.id, shiftClaims.listingId))
        .innerJoin(shifts, eq(shifts.id, shiftClaims.shiftId))
        .innerJoin(positions, eq(positions.id, shifts.positionId))
        .innerJoin(employees, eq(employees.id, shiftClaims.employeeId))
        .where(and(eq(marketplaceListings.facilityId, facilityId), eq(shiftClaims.status, "pending")))
        .orderBy(asc(shifts.startsAt), asc(shiftClaims.createdAt))
    : [];

  const openCallouts = await db
    .select({ callout: callouts, first: employees.firstName, last: employees.lastName, startsAt: shifts.startsAt, positionCode: positions.code, reportedBy: users.displayName })
    .from(callouts)
    .innerJoin(shiftAssignments, eq(shiftAssignments.id, callouts.assignmentId))
    .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .leftJoin(users, eq(users.id, callouts.reportedBy))
    .where(and(eq(callouts.facilityId, facilityId), sql`(${callouts.status} = 'open' or ${callouts.updatedAt} >= ${since})`))
    .orderBy(sql`${callouts.status} = 'open' desc`, asc(shifts.startsAt))
    .limit(50);

  const swaps = can(actor, "swaps.approve", { facilityId })
    ? await db
        .select({ swap: shiftSwapRequests, startsAt: shiftAssignments.startsAt, positionCode: positions.code, first: employees.firstName, last: employees.lastName })
        .from(shiftSwapRequests)
        .innerJoin(shiftAssignments, eq(shiftAssignments.id, shiftSwapRequests.requesterAssignmentId))
        .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
        .innerJoin(positions, eq(positions.id, shifts.positionId))
        .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
        .where(and(eq(shiftAssignments.facilityId, facilityId), eq(shiftSwapRequests.status, "pending_manager")))
        .orderBy(asc(shiftAssignments.startsAt))
    : [];
  const swapTargets = swaps.length
    ? await db
        .select({ id: shiftAssignments.id, startsAt: shiftAssignments.startsAt, first: employees.firstName, last: employees.lastName })
        .from(shiftAssignments)
        .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
        .where(inArray(shiftAssignments.id, swaps.map((s) => s.swap.targetAssignmentId).filter((x): x is string => !!x)))
    : [];
  const targetNames = swaps.length ? await db.select({ id: employees.id, first: employees.firstName, last: employees.lastName }).from(employees).where(inArray(employees.id, swaps.map((s) => s.swap.targetEmployeeId))) : [];

  return {
    listings,
    claims,
    callouts: openCallouts,
    swaps: swaps.map((s) => ({ ...s, target: swapTargets.find((t) => t.id === s.swap.targetAssignmentId) ?? null, targetName: targetNames.find((t) => t.id === s.swap.targetEmployeeId) })),
  };
}

/** Upcoming assignments at a facility (for "Record a callout"). */
export async function upcomingAssignments(db: Db, actor: Actor, facilityId: string, hours = 72, now = new Date()) {
  if (!can(actor, "callouts.manage", { facilityId })) return [];
  return db
    .select({ id: shiftAssignments.id, startsAt: shiftAssignments.startsAt, endsAt: shiftAssignments.endsAt, first: employees.firstName, last: employees.lastName, positionCode: positions.code })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
    .where(and(eq(shiftAssignments.facilityId, facilityId), eq(shiftAssignments.status, "assigned"), gte(shiftAssignments.endsAt, now), lt(shiftAssignments.startsAt, new Date(now.getTime() + hours * 3_600_000))))
    .orderBy(asc(shiftAssignments.startsAt), asc(employees.lastName))
    .limit(300);
}


