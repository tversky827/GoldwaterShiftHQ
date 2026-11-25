/**
 * Shift swaps between two employees.
 *
 *   1. Employee A picks one of their shifts and a colleague's shift (same
 *      facility and position) -> "pending_peer". The rules are checked up front
 *      so impossible swaps are refused immediately.
 *   2. Colleague B accepts -> "pending_manager" (or declines -> "rejected").
 *   3. A manager with swaps.approve approves -> both assignments are marked
 *      "swapped_out" and replaced in ONE transaction, after re-running the
 *      rules for both people with both old assignments ignored.
 */
import { and, asc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { employees, facilities, positions, shiftAssignments, shifts, shiftSwapRequests } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { notify, usersForEmployees, usersWithPermission } from "../notifications";
import { assertCan, can, type Actor } from "../rbac/access";
import { insertAssignmentTx, withFriendlyDbErrors } from "../scheduling/assignments";
import { blockingResults, evaluateAssignment, type Evaluation } from "../scheduling/rules";
import { formatShift } from "./state";

const PENDING = ["pending_peer", "pending_manager"] as const;

function selfEmployee(actor: Actor): string {
  if (!actor.employeeId) throw new ForbiddenError("This account isn't linked to an employee record.");
  if (!can(actor, "self.schedule")) throw new ForbiddenError();
  return actor.employeeId;
}

async function assignmentInfo(db: Db, id: string) {
  const [r] = await db
    .select({ a: shiftAssignments, shift: shifts, facility: facilities, positionCode: positions.code, first: employees.firstName, last: employees.lastName })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .innerJoin(facilities, eq(facilities.id, shiftAssignments.facilityId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
    .where(eq(shiftAssignments.id, id));
  return r;
}
type Info = NonNullable<Awaited<ReturnType<typeof assignmentInfo>>>;

/** Rules for both people after the swap, each with both old assignments ignored. */
async function evaluateSwap(db: Db, mine: Info, theirs: Info | null, targetEmployeeId: string, now: Date) {
  const ignore = [mine.a.id, ...(theirs ? [theirs.a.id] : [])];
  const forTarget = await evaluateAssignment(db, { employeeId: targetEmployeeId, shiftId: mine.shift.id, ignoreAssignmentIds: ignore, now });
  const forRequester = theirs ? await evaluateAssignment(db, { employeeId: mine.a.employeeId, shiftId: theirs.shift.id, ignoreAssignmentIds: ignore, now }) : null;
  return { forTarget, forRequester };
}

function summarize(evs: { who: string; ev: Evaluation | null }[]) {
  const out = { hard: [] as string[], overridable: [] as string[], approvals: [] as string[], all: [] as { ruleType: string; message: string; ev: Evaluation }[] };
  for (const { who, ev } of evs) {
    if (!ev) continue;
    const b = blockingResults(ev);
    out.hard.push(...b.hardBlocks.map((r) => `${who}: ${r.message}`));
    out.overridable.push(...b.overridableBlocks.map((r) => `${who}: ${r.message}`));
    out.approvals.push(...b.approvals.map((r) => `${who}: ${r.message}`));
  }
  return out;
}

/** Colleagues' upcoming shifts this employee could offer to swap with. */
export async function swapOptions(db: Db, actor: Actor, myAssignmentId: string, now = new Date()) {
  const employeeId = selfEmployee(actor);
  const mine = await assignmentInfo(db, myAssignmentId);
  if (!mine || mine.a.employeeId !== employeeId || mine.a.status !== "assigned" || mine.a.startsAt <= now) throw new NotFoundError("Shift");
  const until = new Date(Math.max(mine.a.startsAt.getTime(), now.getTime()) + 14 * 86_400_000);
  const rows = await db
    .select({ id: shiftAssignments.id, startsAt: shiftAssignments.startsAt, endsAt: shiftAssignments.endsAt, employeeId: shiftAssignments.employeeId, first: employees.firstName, last: employees.lastName, preferred: employees.preferredName })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
    .where(
      and(
        eq(shiftAssignments.facilityId, mine.a.facilityId),
        eq(shifts.positionId, mine.shift.positionId),
        eq(shiftAssignments.status, "assigned"),
        ne(shiftAssignments.employeeId, employeeId),
        ne(shiftAssignments.shiftId, mine.shift.id),
        gt(shiftAssignments.startsAt, now),
        lt(shiftAssignments.startsAt, until),
        // Leave out shifts that clash with one of my OTHER shifts (the rules engine re-checks everything on request).
        sql`not exists (select 1 from ${shiftAssignments} me where me.employee_id = ${employeeId} and me.status = 'assigned' and me.id <> ${mine.a.id} and me.starts_at < ${shiftAssignments.endsAt} and me.ends_at > ${shiftAssignments.startsAt})`,
      ),
    )
    .orderBy(asc(shiftAssignments.startsAt))
    .limit(25);
  return {
    mine: { id: mine.a.id, startsAt: mine.a.startsAt, endsAt: mine.a.endsAt, facilityName: mine.facility.name, facilityTimezone: mine.facility.timezone, positionCode: mine.positionCode },
    // Colleagues are shown by first name and last initial only.
    options: rows.map((r) => ({ id: r.id, startsAt: r.startsAt, endsAt: r.endsAt, name: `${r.preferred ?? r.first} ${r.last.slice(0, 1)}.` })),
  };
}

export async function requestSwap(db: Db, actor: Actor, ctx: AuditContext, input: { myAssignmentId: string; targetAssignmentId: string; note?: string }, now = new Date()) {
  const employeeId = selfEmployee(actor);
  const mine = await assignmentInfo(db, input.myAssignmentId);
  if (!mine || mine.a.employeeId !== employeeId) throw new NotFoundError("Shift");
  const theirs = await assignmentInfo(db, input.targetAssignmentId);
  if (!theirs || theirs.facility.organizationId !== actor.organizationId) throw new NotFoundError("Shift");
  if (mine.a.status !== "assigned" || theirs.a.status !== "assigned") throw new AppError("One of these shifts is no longer assigned.");
  if (mine.a.startsAt <= now || theirs.a.startsAt <= now) throw new AppError("Only upcoming shifts can be swapped.");
  if (theirs.a.employeeId === employeeId) throw new AppError("Choose a colleague's shift.");
  if (theirs.a.facilityId !== mine.a.facilityId || theirs.shift.positionId !== mine.shift.positionId) throw new AppError("Swaps are between shifts at the same facility and position.");
  const [dupe] = await db.select({ id: shiftSwapRequests.id }).from(shiftSwapRequests).where(and(inArray(shiftSwapRequests.status, [...PENDING]), or(inArray(shiftSwapRequests.requesterAssignmentId, [mine.a.id, theirs.a.id]), inArray(shiftSwapRequests.targetAssignmentId, [mine.a.id, theirs.a.id]))));
  if (dupe) throw new AppError("One of these shifts already has a swap in progress.");

  const { forTarget, forRequester } = await evaluateSwap(db, mine, theirs, theirs.a.employeeId, now);
  const s = summarize([{ who: theirs.first, ev: forTarget }, { who: "You", ev: forRequester }]);
  if (s.hard.length) throw new AppError(`This swap isn't possible: ${s.hard.join(" ")}`);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(shiftSwapRequests)
      .values({ requesterEmployeeId: employeeId, requesterAssignmentId: mine.a.id, targetEmployeeId: theirs.a.employeeId, targetAssignmentId: theirs.a.id, note: input.note?.trim().slice(0, 300) || null, ruleEvaluation: { forTarget: forTarget.results, forRequester: forRequester?.results ?? [] } })
      .returning({ id: shiftSwapRequests.id });
    await audit(tx, ctx, { action: "swap.requested", entityType: "shift_swap", entityId: row.id, facilityId: mine.a.facilityId, after: { requesterAssignmentId: mine.a.id, targetAssignmentId: theirs.a.id } });
    await notify(tx, { organizationId: actor.organizationId, userIds: await usersForEmployees(tx, [theirs.a.employeeId]), category: "swap_request", title: "Shift swap request", body: `${mine.first} would like to trade their ${formatShift(mine.a.startsAt, mine.facility.timezone)} shift for your ${formatShift(theirs.a.startsAt, theirs.facility.timezone)} shift.`, data: { swapId: row.id } });
    return { swapId: row.id, needsReview: [...s.overridable, ...s.approvals] };
  });
}

/** The colleague accepts or declines. */
export async function respondToSwap(db: Db, actor: Actor, ctx: AuditContext, swapId: string, accept: boolean) {
  const employeeId = selfEmployee(actor);
  const [sw] = await db.select().from(shiftSwapRequests).where(eq(shiftSwapRequests.id, swapId));
  if (!sw || sw.targetEmployeeId !== employeeId) throw new NotFoundError("Swap request");
  if (sw.status !== "pending_peer") throw new AppError("This swap request has already been answered.");
  const mine = await assignmentInfo(db, sw.requesterAssignmentId);
  await db.transaction(async (tx) => {
    await tx.update(shiftSwapRequests).set({ status: accept ? "pending_manager" : "rejected", peerRespondedAt: new Date(), ...(accept ? {} : { decisionReason: "Declined by colleague" }) }).where(eq(shiftSwapRequests.id, swapId));
    await audit(tx, ctx, { action: accept ? "swap.peer_accepted" : "swap.peer_declined", entityType: "shift_swap", entityId: swapId, facilityId: mine?.a.facilityId ?? null });
    if (accept && mine) {
      await notify(tx, { organizationId: actor.organizationId, userIds: await usersWithPermission(tx, actor.organizationId, "swaps.approve", mine.a.facilityId), category: "swap_review", title: "Shift swap needs approval", body: `${mine.first} and ${actor.displayName} agreed to swap shifts (${mine.positionCode}, ${formatShift(mine.a.startsAt, mine.facility.timezone)}).`, data: { swapId } });
    }
    if (sw.requesterEmployeeId) {
      await notify(tx, { organizationId: actor.organizationId, userIds: await usersForEmployees(tx, [sw.requesterEmployeeId]), category: "swap_update", title: accept ? "Swap accepted" : "Swap declined", body: accept ? `${actor.displayName} accepted. A manager will approve it next.` : `${actor.displayName} declined your swap request.`, data: { swapId } });
    }
  });
}

/** The requester changes their mind while the swap is pending. */
export async function cancelSwap(db: Db, actor: Actor, ctx: AuditContext, swapId: string) {
  const employeeId = selfEmployee(actor);
  const [sw] = await db.select().from(shiftSwapRequests).where(eq(shiftSwapRequests.id, swapId));
  if (!sw || sw.requesterEmployeeId !== employeeId) throw new NotFoundError("Swap request");
  if (!PENDING.includes(sw.status as "pending_peer")) throw new AppError("This swap request is already closed.");
  await db.transaction(async (tx) => {
    await tx.update(shiftSwapRequests).set({ status: "cancelled" }).where(eq(shiftSwapRequests.id, swapId));
    await audit(tx, ctx, { action: "swap.cancelled", entityType: "shift_swap", entityId: swapId });
  });
}

export interface SwapDecision {
  ok: boolean;
  message: string;
  needs?: "explanation" | "override_permission" | "approval_permission";
}

/** Manager decision. Re-checks every rule for both people at decision time. */
export async function decideSwap(db: Db, actor: Actor, ctx: AuditContext, swapId: string, approve: boolean, reason: string, now = new Date()): Promise<SwapDecision> {
  const [sw] = await db.select().from(shiftSwapRequests).where(eq(shiftSwapRequests.id, swapId));
  if (!sw) throw new NotFoundError("Swap request");
  const mine = await assignmentInfo(db, sw.requesterAssignmentId);
  const theirs = sw.targetAssignmentId ? await assignmentInfo(db, sw.targetAssignmentId) : null;
  if (!mine || mine.facility.organizationId !== actor.organizationId) throw new NotFoundError("Swap request");
  assertCan(actor, "swaps.approve", { facilityId: mine.a.facilityId });
  if (theirs) assertCan(actor, "swaps.approve", { facilityId: theirs.a.facilityId });
  if (sw.status !== "pending_manager") throw new AppError(sw.status === "pending_peer" ? "The colleague hasn't accepted yet." : "This swap request is already closed.");
  const explanation = reason.trim();
  const people = await usersForEmployees(db, [mine.a.employeeId, sw.targetEmployeeId]);
  const [target] = await db.select({ first: employees.firstName }).from(employees).where(eq(employees.id, sw.targetEmployeeId));

  if (!approve) {
    await db.transaction(async (tx) => {
      await tx.update(shiftSwapRequests).set({ status: "rejected", decidedBy: actor.userId, decidedAt: now, decisionReason: explanation || null }).where(eq(shiftSwapRequests.id, swapId));
      await audit(tx, ctx, { action: "swap.rejected", entityType: "shift_swap", entityId: swapId, facilityId: mine.a.facilityId, reason: explanation || null });
      await notify(tx, { organizationId: actor.organizationId, userIds: people, category: "swap_update", title: "Swap not approved", body: `The swap of ${formatShift(mine.a.startsAt, mine.facility.timezone)} was not approved.${explanation ? ` Note: ${explanation}` : ""}`, data: { swapId } });
    });
    return { ok: true, message: "Declined. Both employees have been notified." };
  }

  if (mine.a.status !== "assigned" || (theirs && theirs.a.status !== "assigned")) return { ok: false, message: "One of these shifts has changed since the request, so it can't be swapped." };
  if (mine.a.startsAt <= now || (theirs && theirs.a.startsAt <= now)) return { ok: false, message: "One of these shifts has already started." };
  const { forTarget, forRequester } = await evaluateSwap(db, mine, theirs, sw.targetEmployeeId, now);
  const s = summarize([{ who: target?.first ?? "Colleague", ev: forTarget }, { who: mine.first, ev: forRequester }]);
  if (s.hard.length) return { ok: false, message: `Can't approve: ${s.hard.join(" ")}` };
  if (s.overridable.length && !can(actor, "rules.override", { facilityId: mine.a.facilityId })) return { ok: false, needs: "override_permission", message: `This needs a rule override, which your role can't grant: ${s.overridable.join(" ")}` };
  if (s.approvals.length && !can(actor, "assignments.approve", { facilityId: mine.a.facilityId })) return { ok: false, needs: "approval_permission", message: `This needs approval from someone who can approve assignments: ${s.approvals.join(" ")}` };
  if ((s.overridable.length || s.approvals.length) && explanation.length < 5) return { ok: false, needs: "explanation", message: `Add a short explanation to approve: ${[...s.overridable, ...s.approvals].join(" ")}` };

  const overriddenOf = (ev: Evaluation | null) => (ev ? (({ overridableBlocks, approvals }) => [...overridableBlocks, ...approvals])(blockingResults(ev)) : []);
  await withFriendlyDbErrors(db, async (tx) => {
    const out = { status: "swapped_out" as const, cancelledAt: now, cancelledBy: actor.userId, cancelReason: "Swapped" };
    await tx.update(shiftAssignments).set(out).where(inArray(shiftAssignments.id, [mine.a.id, ...(theirs ? [theirs.a.id] : [])]));
    const newForTarget = await insertAssignmentTx(tx, ctx, actor.userId, { shiftId: mine.shift.id, employeeId: sw.targetEmployeeId, facilityId: mine.a.facilityId, evaluation: forTarget, overridden: overriddenOf(forTarget), explanation, via: "swap", approvedBy: actor.userId });
    const newForRequester = theirs && forRequester ? await insertAssignmentTx(tx, ctx, actor.userId, { shiftId: theirs.shift.id, employeeId: mine.a.employeeId, facilityId: theirs.a.facilityId, evaluation: forRequester, overridden: overriddenOf(forRequester), explanation, via: "swap", approvedBy: actor.userId }) : null;
    await tx.update(shiftSwapRequests).set({ status: "approved", decidedBy: actor.userId, decidedAt: now, decisionReason: explanation || null }).where(eq(shiftSwapRequests.id, swapId));
    await audit(tx, ctx, { action: "swap.approved", entityType: "shift_swap", entityId: swapId, facilityId: mine.a.facilityId, before: { requesterAssignmentId: mine.a.id, targetAssignmentId: theirs?.a.id ?? null }, after: { newForTarget, newForRequester }, reason: explanation || null });
    await notify(tx, { organizationId: actor.organizationId, userIds: people, category: "swap_update", title: "Swap approved", body: "Your shift swap was approved. Your schedule is updated.", data: { swapId } });
  });
  return { ok: true, message: "Approved. Both schedules are updated." };
}

/** Swap requests involving the signed-in employee. */
export async function mySwaps(db: Db, actor: Actor) {
  const employeeId = selfEmployee(actor);
  const rows = await db
    .select()
    .from(shiftSwapRequests)
    .where(and(inArray(shiftSwapRequests.status, [...PENDING]), or(eq(shiftSwapRequests.requesterEmployeeId, employeeId), eq(shiftSwapRequests.targetEmployeeId, employeeId))))
    .orderBy(asc(shiftSwapRequests.createdAt));
  const out = [];
  for (const r of rows) {
    const mine = await assignmentInfo(db, r.requesterAssignmentId);
    const theirs = r.targetAssignmentId ? await assignmentInfo(db, r.targetAssignmentId) : null;
    if (!mine) continue;
    out.push({
      id: r.id,
      status: r.status,
      incoming: r.targetEmployeeId === employeeId,
      requesterAssignmentId: r.requesterAssignmentId,
      note: r.note,
      requesterName: `${mine.first} ${mine.last.slice(0, 1)}.`,
      targetName: theirs ? `${theirs.first} ${theirs.last.slice(0, 1)}.` : "",
      requesterShift: { startsAt: mine.a.startsAt, endsAt: mine.a.endsAt, facilityName: mine.facility.name, facilityTimezone: mine.facility.timezone, positionName: mine.positionCode },
      targetShift: theirs ? { startsAt: theirs.a.startsAt, endsAt: theirs.a.endsAt, facilityName: theirs.facility.name, facilityTimezone: theirs.facility.timezone, positionName: theirs.positionCode } : null,
    });
  }
  return out;
}
