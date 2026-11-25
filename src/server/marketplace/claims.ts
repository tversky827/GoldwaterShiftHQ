/**
 * Claiming open shifts (employee "Pick Up" tab) and reviewing claims.
 *
 * A claim runs the SAME rules engine as a scheduler assignment:
 *   hard block (not overridable)            -> refused, with the reason
 *   approval required / overridable block /
 *   listing requires approval               -> pending claim for a reviewer
 *   otherwise                               -> assigned immediately (atomic)
 *
 * Atomicity: the assignment insert goes through the database trigger that
 * locks the shift row and refuses overfill, so when two people tap "Pick up"
 * on the last opening at the same moment, exactly one wins and the other is
 * offered the waitlist.
 */
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { callouts, employeeFacilityAuthorizations, employeePositions, employees, facilities, marketplaceListings, positions, shiftAssignments, shiftClaims, shifts, shiftWaitlists } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { notify, usersForEmployees, usersWithPermission } from "../notifications";
import { assertCan, can, type Actor } from "../rbac/access";
import { insertAssignmentTx, withFriendlyDbErrors } from "../scheduling/assignments";
import { blockingResults, evaluateAssignment, type Evaluation } from "../scheduling/rules";
import { audienceScope, formatShift, refreshShiftMarket } from "./state";

function selfEmployee(actor: Actor): string {
  if (!actor.employeeId) throw new ForbiddenError("This account isn't linked to an employee record.");
  if (!can(actor, "self.marketplace")) throw new ForbiddenError();
  return actor.employeeId;
}

async function employeeReach(db: Db, employeeId: string) {
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) throw new NotFoundError("Employee");
  const [pos, auth] = await Promise.all([
    db.select({ id: employeePositions.positionId }).from(employeePositions).where(eq(employeePositions.employeeId, employeeId)),
    db.select({ f: employeeFacilityAuthorizations.facilityId }).from(employeeFacilityAuthorizations).where(and(eq(employeeFacilityAuthorizations.employeeId, employeeId), isNull(employeeFacilityAuthorizations.revokedAt))),
  ]);
  return { emp, positionIds: pos.map((p) => p.id), authorized: new Set(auth.map((a) => a.f)) };
}

type Reach = Awaited<ReturnType<typeof employeeReach>>;
function canSee(reach: Reach, facilityId: string, positionId: string, audience: unknown) {
  if (!["active", "leave"].includes(reach.emp.employmentStatus)) return false;
  if (!reach.positionIds.includes(positionId)) return false;
  if (reach.emp.homeFacilityId === facilityId) return true;
  return audienceScope(audience) === "authorized" && reach.authorized.has(facilityId);
}

/** How a claim would be handled right now. */
export function claimMode(ev: Evaluation, listingRequiresApproval: boolean) {
  const { hardBlocks, overridableBlocks, approvals, warnings } = blockingResults(ev);
  if (hardBlocks.length) return { mode: "blocked" as const, reasons: hardBlocks.map((r) => r.message), warnings: [] as string[] };
  const review = [...overridableBlocks, ...approvals].map((r) => r.message);
  if (review.length || listingRequiresApproval) return { mode: "review" as const, reasons: review.length ? review : ["This facility reviews every pick-up."], warnings: warnings.map((w) => w.message) };
  return { mode: "instant" as const, reasons: [] as string[], warnings: warnings.map((w) => w.message) };
}

const listingCols = {
  listing: marketplaceListings,
  shift: shifts,
  facilityName: facilities.name,
  facilityTimezone: facilities.timezone,
  organizationId: facilities.organizationId,
  positionCode: positions.code,
  positionName: positions.name,
  filled: sql<number>`(select count(*)::int from ${shiftAssignments} sa where sa.shift_id = ${shifts.id} and sa.status = 'assigned')`,
  isCallout: sql<boolean>`exists (select 1 from ${callouts} co where co.listing_id = ${marketplaceListings.id})`,
};

export interface OpenShiftCard {
  listingId: string;
  shiftId: string;
  startsAt: Date;
  endsAt: Date;
  facilityName: string;
  facilityTimezone: string;
  positionName: string;
  positionCode: string;
  paidHours: number;
  incentiveText: string | null;
  isCallout: boolean;
  open: number;
  mode: "instant" | "review";
  reasons: string[];
  warnings: string[];
  hoursAfter: number;
}

/** The employee's Pick Up tab: eligible open shifts, their requests, and waitlists. */
export async function openShiftsForMe(db: Db, actor: Actor, now = new Date()) {
  const employeeId = selfEmployee(actor);
  const reach = await employeeReach(db, employeeId);
  const empty = { available: [] as OpenShiftCard[], requested: [] as Awaited<ReturnType<typeof myRequests>>, full: [] as { listingId: string; shiftId: string; startsAt: Date; endsAt: Date; facilityName: string; facilityTimezone: string; positionName: string; onWaitlist: string | null }[] };
  if (!reach.positionIds.length || !["active", "leave"].includes(reach.emp.employmentStatus)) return { ...empty, requested: await myRequests(db, employeeId) };
  const facIds = [...new Set([reach.emp.homeFacilityId, ...reach.authorized].filter((x): x is string => !!x))];
  if (!facIds.length) return { ...empty, requested: await myRequests(db, employeeId) };

  const rows = await db
    .select(listingCols)
    .from(marketplaceListings)
    .innerJoin(shifts, eq(shifts.id, marketplaceListings.shiftId))
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(
      and(
        inArray(marketplaceListings.status, ["open", "filled"]),
        lte(marketplaceListings.publishAt, now),
        or(isNull(marketplaceListings.expiresAt), gt(marketplaceListings.expiresAt, now)),
        gt(shifts.startsAt, now),
        eq(shifts.status, "active"),
        inArray(shifts.facilityId, facIds),
        inArray(shifts.positionId, reach.positionIds),
        sql`not exists (select 1 from ${shiftAssignments} mine where mine.shift_id = ${shifts.id} and mine.employee_id = ${employeeId} and mine.status = 'assigned')`,
        sql`not exists (select 1 from ${shiftClaims} c where c.listing_id = ${marketplaceListings.id} and c.employee_id = ${employeeId} and c.status = 'pending')`,
      ),
    )
    .orderBy(asc(shifts.startsAt))
    .limit(80);

  const visible = rows.filter((r) => canSee(reach, r.shift.facilityId, r.shift.positionId, r.listing.audience));
  const waitlist = visible.length ? await db.select().from(shiftWaitlists).where(and(eq(shiftWaitlists.employeeId, employeeId), inArray(shiftWaitlists.shiftId, visible.map((v) => v.shift.id)), inArray(shiftWaitlists.status, ["waiting", "offered"]))) : [];

  const available: OpenShiftCard[] = [];
  const full: (typeof empty)["full"] = [];
  for (const r of visible) {
    const open = r.shift.requiredCount - r.filled;
    if (r.listing.status === "filled" || open <= 0) {
      full.push({ listingId: r.listing.id, shiftId: r.shift.id, startsAt: r.shift.startsAt, endsAt: r.shift.endsAt, facilityName: r.facilityName, facilityTimezone: r.facilityTimezone, positionName: r.positionName, onWaitlist: waitlist.find((w) => w.shiftId === r.shift.id)?.status ?? null });
      continue;
    }
    if (available.length >= 40) continue;
    const ev = await evaluateAssignment(db, { employeeId, shiftId: r.shift.id, now });
    const m = claimMode(ev, r.listing.requiresApproval);
    if (m.mode === "blocked") continue; // not eligible (e.g. overlaps another shift): don't show it
    available.push({
      listingId: r.listing.id,
      shiftId: r.shift.id,
      startsAt: r.shift.startsAt,
      endsAt: r.shift.endsAt,
      facilityName: r.facilityName,
      facilityTimezone: r.facilityTimezone,
      positionName: r.positionName,
      positionCode: r.positionCode,
      paidHours: Number(r.shift.paidHours),
      incentiveText: r.listing.incentiveText,
      isCallout: r.isCallout,
      open,
      mode: m.mode,
      reasons: m.reasons,
      warnings: m.warnings,
      hoursAfter: ev.hours.afterAssignment,
    });
  }
  return { available, requested: await myRequests(db, employeeId), full: full.slice(0, 20) };
}

async function myRequests(db: Db, employeeId: string) {
  return db
    .select({ id: shiftClaims.id, createdAt: shiftClaims.createdAt, startsAt: shifts.startsAt, endsAt: shifts.endsAt, facilityName: facilities.name, facilityTimezone: facilities.timezone, positionName: positions.name })
    .from(shiftClaims)
    .innerJoin(shifts, eq(shifts.id, shiftClaims.shiftId))
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(and(eq(shiftClaims.employeeId, employeeId), eq(shiftClaims.status, "pending")))
    .orderBy(asc(shifts.startsAt));
}

async function loadListing(db: Db, listingId: string) {
  const [r] = await db
    .select(listingCols)
    .from(marketplaceListings)
    .innerJoin(shifts, eq(shifts.id, marketplaceListings.shiftId))
    .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(eq(marketplaceListings.id, listingId));
  return r;
}

export type ClaimStatus = "assigned" | "pending" | "full" | "blocked";
export interface ClaimResult {
  status: ClaimStatus;
  claimId?: string;
  message: string;
}

export async function claimShift(db: Db, actor: Actor, ctx: AuditContext, listingId: string, now = new Date()): Promise<ClaimResult> {
  const employeeId = selfEmployee(actor);
  const l = await loadListing(db, listingId);
  if (!l || l.organizationId !== actor.organizationId) throw new NotFoundError("Open shift");
  const reach = await employeeReach(db, employeeId);
  if (!canSee(reach, l.shift.facilityId, l.shift.positionId, l.listing.audience)) throw new NotFoundError("Open shift");
  if (l.listing.status === "filled" || (l.listing.status === "open" && l.filled >= l.shift.requiredCount)) return { status: "full", message: "Someone just picked up this shift. Join the waitlist and we'll tell you if a spot opens." };
  if (l.listing.status !== "open" || l.listing.publishAt > now || (l.listing.expiresAt && l.listing.expiresAt <= now) || l.shift.startsAt <= now) throw new AppError("This open shift is no longer available.");

  const ev = await evaluateAssignment(db, { employeeId, shiftId: l.shift.id, now });
  const m = claimMode(ev, l.listing.requiresApproval);
  if (m.mode === "blocked") {
    if (ev.results.some((r) => r.ruleType === "shift_capacity" && r.outcome === "hard_block") && l.shift.status === "active") return { status: "full", message: "Someone just picked up this shift. Join the waitlist and we'll tell you if a spot opens." };
    return { status: "blocked", message: `You can't pick up this shift: ${m.reasons.join(" ")}` };
  }
  const snapshot = { outcome: ev.outcome, results: ev.results, hours: { projectedAfter: ev.hours.afterAssignment } };

  // A previous claim whose assignment was later removed shouldn't block a new one.
  await db
    .update(shiftClaims)
    .set({ status: "cancelled", decisionReason: "Assignment was later removed." })
    .where(and(eq(shiftClaims.listingId, listingId), eq(shiftClaims.employeeId, employeeId), inArray(shiftClaims.status, ["approved", "auto_approved"]), sql`not exists (select 1 from ${shiftAssignments} sa where sa.id = ${shiftClaims.assignmentId} and sa.status = 'assigned')`));

  if (m.mode === "review") {
    const claimId = await withFriendlyDbErrors(db, async (tx) => {
      const [c] = await tx.insert(shiftClaims).values({ listingId, shiftId: l.shift.id, employeeId, status: "pending", ruleEvaluation: snapshot }).returning({ id: shiftClaims.id });
      await audit(tx, ctx, { action: "claim.requested", entityType: "shift_claim", entityId: c.id, facilityId: l.shift.facilityId, after: { listingId, shiftId: l.shift.id, employeeId, reasons: m.reasons } });
      const reviewers = await usersWithPermission(tx, actor.organizationId, "claims.review", l.shift.facilityId);
      await notify(tx, { organizationId: actor.organizationId, userIds: reviewers, category: "claim_review", title: "Shift pick-up needs review", body: `${actor.displayName} asked to pick up ${l.positionCode} on ${formatShift(l.shift.startsAt, l.facilityTimezone)}. ${m.reasons.join(" ")}`, data: { claimId: c.id, facilityId: l.shift.facilityId } });
      return c.id;
    });
    return { status: "pending", claimId, message: "Requested. A manager will review it, and you'll get a notification with the decision." };
  }

  try {
    const claimId = await withFriendlyDbErrors(db, async (tx) => {
      const assignmentId = await insertAssignmentTx(tx, ctx, actor.userId, { shiftId: l.shift.id, employeeId, facilityId: l.shift.facilityId, evaluation: ev, overridden: [], explanation: "", via: "marketplace", approvedBy: null });
      const [c] = await tx.insert(shiftClaims).values({ listingId, shiftId: l.shift.id, employeeId, status: "auto_approved", ruleEvaluation: snapshot, assignmentId, decidedAt: now }).returning({ id: shiftClaims.id });
      await tx.update(shiftWaitlists).set({ status: "claimed" }).where(and(eq(shiftWaitlists.shiftId, l.shift.id), eq(shiftWaitlists.employeeId, employeeId), inArray(shiftWaitlists.status, ["waiting", "offered"])));
      await audit(tx, ctx, { action: "claim.auto_approved", entityType: "shift_claim", entityId: c.id, facilityId: l.shift.facilityId, after: { listingId, assignmentId, warnings: m.warnings } });
      await refreshShiftMarket(tx, ctx, l.shift.id, now);
      return c.id;
    });
    return { status: "assigned", claimId, message: m.warnings.length ? `It's yours. Heads up: ${m.warnings.join(" ")}` : "It's yours. The shift is on your schedule." };
  } catch (e) {
    if (e instanceof AppError && /fully staffed/.test(e.message)) return { status: "full", message: "Someone just picked up this shift. Join the waitlist and we'll tell you if a spot opens." };
    throw e;
  }
}

export async function withdrawClaim(db: Db, actor: Actor, ctx: AuditContext, claimId: string) {
  const employeeId = selfEmployee(actor);
  const [c] = await db.select().from(shiftClaims).where(eq(shiftClaims.id, claimId));
  if (!c || c.employeeId !== employeeId) throw new NotFoundError("Request");
  if (c.status !== "pending") throw new AppError("This request has already been decided.");
  await db.transaction(async (tx) => {
    await tx.update(shiftClaims).set({ status: "withdrawn", decidedAt: new Date() }).where(eq(shiftClaims.id, claimId));
    await audit(tx, ctx, { action: "claim.withdrawn", entityType: "shift_claim", entityId: claimId });
  });
}

/* --------------------------------------------------------------- waitlist */

export async function joinWaitlist(db: Db, actor: Actor, ctx: AuditContext, listingId: string) {
  const employeeId = selfEmployee(actor);
  const l = await loadListing(db, listingId);
  if (!l || l.organizationId !== actor.organizationId) throw new NotFoundError("Open shift");
  const reach = await employeeReach(db, employeeId);
  if (!canSee(reach, l.shift.facilityId, l.shift.positionId, l.listing.audience)) throw new NotFoundError("Open shift");
  if (l.shift.startsAt <= new Date() || !["open", "filled"].includes(l.listing.status)) throw new AppError("This shift is no longer available.");
  await withFriendlyDbErrors(db, async (tx) => {
    const [w] = await tx.insert(shiftWaitlists).values({ shiftId: l.shift.id, employeeId }).onConflictDoNothing().returning({ id: shiftWaitlists.id });
    if (w) await audit(tx, ctx, { action: "waitlist.joined", entityType: "shift_waitlist", entityId: w.id, facilityId: l.shift.facilityId, after: { shiftId: l.shift.id } });
  });
}

export async function leaveWaitlist(db: Db, actor: Actor, ctx: AuditContext, shiftId: string) {
  const employeeId = selfEmployee(actor);
  await db.transaction(async (tx) => {
    const rows = await tx.update(shiftWaitlists).set({ status: "removed" }).where(and(eq(shiftWaitlists.shiftId, shiftId), eq(shiftWaitlists.employeeId, employeeId), inArray(shiftWaitlists.status, ["waiting", "offered"]))).returning({ id: shiftWaitlists.id });
    for (const r of rows) await audit(tx, ctx, { action: "waitlist.left", entityType: "shift_waitlist", entityId: r.id });
  });
}

/* ----------------------------------------------------------------- review */

export interface ReviewResult {
  ok: boolean;
  message: string;
  needs?: "explanation" | "override_permission" | "approval_permission";
}

/**
 * Approve or decline a pending claim. Re-runs the rules at decision time.
 * Overriding a block needs rules.override; approving an "approval required"
 * rule (e.g. overtime) needs assignments.approve; both need an explanation.
 */
export async function reviewClaim(db: Db, actor: Actor, ctx: AuditContext, claimId: string, approve: boolean, reason: string, now = new Date()): Promise<ReviewResult> {
  const [c] = await db.select({ claim: shiftClaims, shift: shifts, facility: facilities, positionCode: positions.code }).from(shiftClaims).innerJoin(shifts, eq(shifts.id, shiftClaims.shiftId)).innerJoin(facilities, eq(facilities.id, shifts.facilityId)).innerJoin(positions, eq(positions.id, shifts.positionId)).where(eq(shiftClaims.id, claimId));
  if (!c || c.facility.organizationId !== actor.organizationId) throw new NotFoundError("Request");
  assertCan(actor, "claims.review", { facilityId: c.facility.id, departmentId: c.shift.departmentId ?? undefined });
  if (c.claim.status !== "pending") throw new AppError("This request has already been decided.");
  const explanation = reason.trim();
  const target = { facilityId: c.facility.id };
  const when = formatShift(c.shift.startsAt, c.facility.timezone);
  const employeeUsers = await usersForEmployees(db, [c.claim.employeeId]);

  if (!approve) {
    await db.transaction(async (tx) => {
      await tx.update(shiftClaims).set({ status: "rejected", decidedBy: actor.userId, decidedAt: now, decisionReason: explanation || null }).where(eq(shiftClaims.id, claimId));
      await audit(tx, ctx, { action: "claim.rejected", entityType: "shift_claim", entityId: claimId, facilityId: c.facility.id, reason: explanation || null });
      await notify(tx, { organizationId: actor.organizationId, userIds: employeeUsers, category: "claim_decided", title: "Pick-up request declined", body: `Your request for ${c.positionCode} on ${when} at ${c.facility.name} was declined.${explanation ? ` Note: ${explanation}` : ""}`, data: { claimId } });
    });
    return { ok: true, message: "Declined. The employee has been notified." };
  }

  if (c.shift.startsAt <= now) throw new AppError("This shift has already started.");
  const ev = await evaluateAssignment(db, { employeeId: c.claim.employeeId, shiftId: c.shift.id, now });
  const { hardBlocks, overridableBlocks, approvals } = blockingResults(ev);
  if (hardBlocks.length) return { ok: false, message: `Can't approve: ${hardBlocks.map((r) => r.message).join(" ")}` };
  if (overridableBlocks.length && !can(actor, "rules.override", target)) return { ok: false, needs: "override_permission", message: `This needs a rule override, which your role can't grant: ${overridableBlocks.map((r) => r.message).join(" ")}` };
  if (approvals.length && !can(actor, "assignments.approve", target)) return { ok: false, needs: "approval_permission", message: `This needs approval from someone who can approve assignments: ${approvals.map((r) => r.message).join(" ")}` };
  const overridden = [...overridableBlocks, ...approvals];
  if (overridden.length && explanation.length < 5) return { ok: false, needs: "explanation", message: `Add a short explanation to approve: ${overridden.map((r) => r.message).join(" ")}` };

  await withFriendlyDbErrors(db, async (tx) => {
    const assignmentId = await insertAssignmentTx(tx, ctx, actor.userId, { shiftId: c.shift.id, employeeId: c.claim.employeeId, facilityId: c.facility.id, evaluation: ev, overridden, explanation, via: "marketplace", approvedBy: actor.userId });
    await tx.update(shiftClaims).set({ status: "approved", assignmentId, decidedBy: actor.userId, decidedAt: now, decisionReason: explanation || null }).where(eq(shiftClaims.id, claimId));
    await tx.update(shiftWaitlists).set({ status: "claimed" }).where(and(eq(shiftWaitlists.shiftId, c.shift.id), eq(shiftWaitlists.employeeId, c.claim.employeeId), inArray(shiftWaitlists.status, ["waiting", "offered"])));
    await audit(tx, ctx, { action: overridden.length ? "claim.approved_with_override" : "claim.approved", entityType: "shift_claim", entityId: claimId, facilityId: c.facility.id, after: { assignmentId, overridden: overridden.map((r) => r.ruleType) }, reason: explanation || null });
    await notify(tx, { organizationId: actor.organizationId, userIds: employeeUsers, category: "claim_decided", title: "Shift approved", body: `You're on ${c.positionCode} at ${c.facility.name}, ${when}. It's on your schedule.`, data: { claimId, assignmentId } });
    await refreshShiftMarket(tx, ctx, c.shift.id, now);
  });
  return { ok: true, message: "Approved and added to the schedule." };
}
