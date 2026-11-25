/**
 * Shared marketplace state, kept consistent whenever an opening is filled or
 * freed (claim, approval, scheduler assignment, removal, callout, swap).
 *
 *   shift now full  -> live listing becomes "filled", other pending claims are
 *                      closed ("the shift was filled"), open callouts "covered".
 *   opening freed   -> a "filled" listing that hasn't expired reopens, and
 *                      waitlisted employees are offered the spot.
 *
 * This module must not import the assignment service (it is called from it).
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { callouts, employeeFacilityAuthorizations, employeePositions, employees, facilities, marketplaceListings, positions, shiftAssignments, shiftClaims, shifts, shiftWaitlists, users } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { notify, usersForEmployees } from "../notifications";

export type AudienceScope = "home" | "authorized";
export const audienceScope = (a: unknown): AudienceScope => ((a as { scope?: string } | null)?.scope === "home" ? "home" : "authorized");

export const LIVE: ("scheduled" | "open")[] = ["scheduled", "open"];

export async function filledCount(db: Db | Tx, shiftId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, shiftId), eq(shiftAssignments.status, "assigned")));
  return r?.n ?? 0;
}

export function formatShift(startsAt: Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(startsAt);
}

export async function shiftContext(db: Db | Tx, shiftId: string) {
  const [r] = await db
    .select({ shift: shifts, facility: facilities, positionCode: positions.code, positionName: positions.name })
    .from(shifts)
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(eq(shifts.id, shiftId));
  return r;
}

/**
 * Employees who may see a listing for this facility and position:
 * active (or on leave) and classified for the position, and either based at
 * the facility or (scope "authorized") authorized to work there.
 */
export function eligibleEmployeeSql(facilityId: string, positionId: string, scope: AudienceScope) {
  const authorized = sql`exists (select 1 from ${employeeFacilityAuthorizations} efa where efa.employee_id = ${employees.id} and efa.facility_id = ${facilityId} and efa.revoked_at is null)`;
  return and(
    inArray(employees.employmentStatus, ["active", "leave"]),
    sql`exists (select 1 from ${employeePositions} ep where ep.employee_id = ${employees.id} and ep.position_id = ${positionId})`,
    scope === "home" ? eq(employees.homeFacilityId, facilityId) : or(eq(employees.homeFacilityId, facilityId), authorized),
  )!;
}

/** Active app users who may see a listing (for notifications). */
export async function eligibleUserIds(db: Db | Tx, organizationId: string, facilityId: string, positionId: string, scope: AudienceScope): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .where(and(eq(users.organizationId, organizationId), eq(users.status, "active"), eligibleEmployeeSql(facilityId, positionId, scope)));
  return rows.map((r) => r.id);
}

/**
 * Tells eligible employees about newly opened listings, one message per person
 * (a bulk publish of 30 shifts sends one summary, not 30 notifications).
 */
export async function announceListings(db: Db | Tx, organizationId: string, listingIds: string[], opts: { urgent?: boolean; excludeUserIds?: string[]; scopeOverride?: AudienceScope } = {}) {
  if (!listingIds.length) return 0;
  const rows = await db
    .select({ listing: marketplaceListings, shift: shifts, facilityName: facilities.name, tz: facilities.timezone, positionCode: positions.code })
    .from(marketplaceListings)
    .innerJoin(shifts, eq(shifts.id, marketplaceListings.shiftId))
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(inArray(marketplaceListings.id, listingIds));
  const exclude = new Set(opts.excludeUserIds ?? []);
  const perUser = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.listing.status !== "open") continue;
    for (const u of await eligibleUserIds(db, organizationId, r.shift.facilityId, r.shift.positionId, opts.scopeOverride ?? audienceScope(r.listing.audience))) {
      if (exclude.has(u)) continue;
      perUser.set(u, [...(perUser.get(u) ?? []), r]);
    }
  }
  // Group users who would receive the identical message.
  const groups = new Map<string, { userIds: string[]; title: string; body: string; listingIds: string[] }>();
  for (const [userId, list] of perUser) {
    const first = list[0];
    const title = opts.urgent ? "Urgent: shift needs coverage" : list.length === 1 ? "New open shift" : `${list.length} new open shifts`;
    const body =
      list.length === 1
        ? `${first.positionCode} at ${first.facilityName}, ${formatShift(first.shift.startsAt, first.tz)}.${first.listing.incentiveText ? ` ${first.listing.incentiveText}` : ""} Tap Pick Up to claim it.`
        : `${[...new Set(list.map((l) => l.facilityName))].join(", ")}. Open Pick Up to see them.`;
    const ids = list.map((l) => l.listing.id).sort();
    const key = `${title}|${body}|${ids.join(",")}`;
    const g = groups.get(key) ?? { userIds: [], title, body, listingIds: ids };
    g.userIds.push(userId);
    groups.set(key, g);
  }
  let n = 0;
  for (const g of groups.values()) n += await notify(db, { organizationId, userIds: g.userIds, category: opts.urgent ? "callout_coverage" : "open_shift", title: g.title, body: g.body, data: { listingIds: g.listingIds } });
  return n;
}

/** Recomputes listing / claim / callout / waitlist state for one shift. */
export async function refreshShiftMarket(tx: Db | Tx, ctx: AuditContext, shiftId: string, now = new Date()) {
  const sc = await shiftContext(tx, shiftId);
  if (!sc) return;
  const { shift, facility } = sc;
  const filled = await filledCount(tx, shiftId);
  const open = shift.status === "active" ? shift.requiredCount - filled : 0;
  const listings = await tx.select().from(marketplaceListings).where(eq(marketplaceListings.shiftId, shiftId));

  if (open <= 0) {
    const live = listings.filter((l) => LIVE.includes(l.status as "open"));
    if (live.length) {
      await tx.update(marketplaceListings).set({ status: "filled" }).where(inArray(marketplaceListings.id, live.map((l) => l.id)));
      for (const l of live) await audit(tx, ctx, { action: "listing.filled", entityType: "marketplace_listing", entityId: l.id, facilityId: facility.id });
    }
    const closed = await tx
      .update(shiftClaims)
      .set({ status: "rejected", decidedAt: now, decisionReason: "The shift was filled." })
      .where(and(eq(shiftClaims.shiftId, shiftId), eq(shiftClaims.status, "pending")))
      .returning({ employeeId: shiftClaims.employeeId });
    if (closed.length) {
      await notify(tx, { organizationId: facility.organizationId, userIds: await usersForEmployees(tx, closed.map((c) => c.employeeId)), category: "claim_decided", title: "Shift was filled", body: `The ${sc.positionCode} shift at ${facility.name} on ${formatShift(shift.startsAt, facility.timezone)} was filled by someone else. You can join its waitlist.`, data: { shiftId } });
    }
    await tx.update(callouts).set({ status: "covered", resolvedAt: now }).where(and(eq(callouts.shiftId, shiftId), eq(callouts.status, "open")));
    // Anyone offered a spot that's gone goes back to waiting for the next one.
    await tx.update(shiftWaitlists).set({ status: "waiting" }).where(and(eq(shiftWaitlists.shiftId, shiftId), eq(shiftWaitlists.status, "offered")));
    return;
  }

  if (shift.startsAt <= now) return;
  let hasLive = listings.some((l) => LIVE.includes(l.status as "open"));
  const reopenable = listings.filter((l) => l.status === "filled" && (!l.expiresAt || l.expiresAt > now)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!hasLive && reopenable) {
    await tx.update(marketplaceListings).set({ status: "open" }).where(eq(marketplaceListings.id, reopenable.id));
    await audit(tx, ctx, { action: "listing.reopened", entityType: "marketplace_listing", entityId: reopenable.id, facilityId: facility.id });
    hasLive = true;
  }
  if (!hasLive) return;
  const offered = await tx
    .update(shiftWaitlists)
    .set({ status: "offered" })
    .where(and(eq(shiftWaitlists.shiftId, shiftId), eq(shiftWaitlists.status, "waiting")))
    .returning({ employeeId: shiftWaitlists.employeeId });
  if (offered.length) {
    await notify(tx, { organizationId: facility.organizationId, userIds: await usersForEmployees(tx, offered.map((o) => o.employeeId)), category: "waitlist_offer", title: "A spot opened up", body: `The ${sc.positionCode} shift at ${facility.name} on ${formatShift(shift.startsAt, facility.timezone)} has an opening. First to claim it gets it.`, data: { shiftId } });
  }
}

