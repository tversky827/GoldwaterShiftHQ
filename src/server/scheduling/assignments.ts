/**
 * Assigning employees to shifts, with the rules engine in front of every write.
 *
 *   hard block (not overridable) -> refused
 *   hard block (overridable)     -> only someone with rules.override, with an explanation
 *   approval required            -> an approver (assignments.approve) with an explanation,
 *                                   otherwise a pending approval request is created
 *   warning                      -> assigned, warnings returned
 *
 * The database independently guarantees no overlap / no overfill / active
 * employee, so concurrent requests can't break these rules.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { approvalRequests, employees, facilities, notifications, positions, ruleOverrides, shiftAssignments, shifts, users } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError, friendlyDbError, NotFoundError } from "../errors";
import { assertCan, can, type Actor } from "../rbac/access";
import { refreshShiftMarket } from "../marketplace/state";
import { blockingResults, evaluateAssignment, type Evaluation, type RuleResult } from "./rules";

export type AssignStatus = "assigned" | "blocked" | "needs_override" | "needs_approval_reason" | "pending_approval";

export interface AssignResult {
  status: AssignStatus;
  assignmentId?: string;
  approvalRequestId?: string;
  evaluation: Evaluation;
  message: string;
}

async function shiftFacility(db: Db, shiftId: string) {
  const [s] = await db.select({ shift: shifts, facility: facilities }).from(shifts).innerJoin(facilities, eq(facilities.id, shifts.facilityId)).where(eq(shifts.id, shiftId));
  if (!s) throw new NotFoundError("Shift");
  return s;
}

export async function assignEmployee(
  db: Db,
  actor: Actor,
  ctx: AuditContext,
  input: { shiftId: string; employeeId: string; explanation?: string; via?: "scheduler" | "auto" },
): Promise<AssignResult> {
  const { shift, facility } = await shiftFacility(db, input.shiftId);
  if (facility.organizationId !== actor.organizationId) throw new NotFoundError("Shift");
  assertCan(actor, "schedules.manage", { facilityId: facility.id, departmentId: shift.departmentId ?? undefined });

  const evaluation = await evaluateAssignment(db, { employeeId: input.employeeId, shiftId: input.shiftId });
  const { hardBlocks, overridableBlocks, approvals, warnings } = blockingResults(evaluation);
  const explanation = input.explanation?.trim() ?? "";
  const target = { facilityId: facility.id };

  if (hardBlocks.length) return { status: "blocked", evaluation, message: hardBlocks.map((r) => r.message).join(" ") };
  if (overridableBlocks.length && !(can(actor, "rules.override", target) && explanation.length >= 5)) {
    return {
      status: "needs_override",
      evaluation,
      message: can(actor, "rules.override", target) ? "An override with an explanation is required." : `Blocked: ${overridableBlocks.map((r) => r.message).join(" ")} Only someone with override permission can assign this.`,
    };
  }
  if (approvals.length) {
    const canApprove = can(actor, "assignments.approve", target);
    if (canApprove && explanation.length < 5) return { status: "needs_approval_reason", evaluation, message: "This assignment needs approval. Add a short explanation to approve it now." };
    if (!canApprove) {
      const id = await createApprovalRequest(db, actor, ctx, { shiftId: shift.id, facilityId: facility.id, employeeId: input.employeeId, evaluation, note: explanation });
      return { status: "pending_approval", approvalRequestId: id, evaluation, message: "Sent for approval. The employee will be assigned once an approver accepts it." };
    }
  }

  const overridden = [...overridableBlocks, ...approvals];
  const assignmentId = await insertAssignment(db, ctx, actor.userId, { shiftId: shift.id, employeeId: input.employeeId, facilityId: facility.id, evaluation, overridden, explanation, via: input.via ?? "scheduler", approvedBy: approvals.length ? actor.userId : null });
  return { status: "assigned", assignmentId, evaluation, message: warnings.length ? `Assigned with ${warnings.length} warning${warnings.length > 1 ? "s" : ""}: ${warnings.map((w) => w.message).join(" ")}` : "Assigned." };
}

export interface NewAssignment {
  shiftId: string;
  employeeId: string;
  facilityId: string;
  evaluation: Evaluation;
  overridden: RuleResult[];
  explanation: string;
  via: "scheduler" | "auto" | "marketplace" | "swap" | "callout";
  approvedBy: string | null;
}

/**
 * Writes one assignment, its rule overrides and the audit entry inside an
 * existing transaction. The database trigger still enforces capacity, overlap
 * and active-employee rules, so a concurrent winner makes this throw.
 */
export async function insertAssignmentTx(tx: Tx, ctx: AuditContext, userId: string | null, a: NewAssignment): Promise<string> {
  const [row] = await tx
    .insert(shiftAssignments)
    .values({
      shiftId: a.shiftId,
      employeeId: a.employeeId,
      facilityId: a.facilityId,
      startsAt: new Date(0), // replaced by trigger with the shift's own times
      endsAt: new Date(1),
      assignedVia: a.via,
      assignedBy: userId,
      approvedBy: a.approvedBy,
      ruleEvaluation: { outcome: a.evaluation.outcome, results: a.evaluation.results, hours: { projectedAfter: a.evaluation.hours.afterAssignment } },
    })
    .returning({ id: shiftAssignments.id });
  for (const r of a.overridden) {
    if (!userId) throw new AppError("An override needs a person to approve it.");
    await tx.insert(ruleOverrides).values({ ruleId: r.ruleType === "overtime" || r.ruleType === "employee_active" ? null : r.ruleId, ruleType: r.ruleType, subjectType: "shift_assignment", subjectId: row.id, employeeId: a.employeeId, explanation: a.explanation, overriddenBy: userId });
  }
  await audit(tx, ctx, {
    action: a.overridden.length ? "assignment.created_with_override" : "assignment.created",
    entityType: "shift_assignment",
    entityId: row.id,
    facilityId: a.facilityId,
    after: { shiftId: a.shiftId, employeeId: a.employeeId, via: a.via, outcome: a.evaluation.outcome, overridden: a.overridden.map((r) => r.ruleType) },
    reason: a.explanation || null,
  });
  return row.id;
}

/** Runs `fn` in a transaction and turns integrity-trigger errors into friendly AppErrors. */
export async function withFriendlyDbErrors<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (e) {
    const friendly = friendlyDbError(e);
    if (friendly) throw new AppError(friendly);
    throw e;
  }
}

async function insertAssignment(db: Db, ctx: AuditContext, userId: string, a: NewAssignment) {
  return withFriendlyDbErrors(db, async (tx) => {
    const id = await insertAssignmentTx(tx, ctx, userId, a);
    await refreshShiftMarket(tx, ctx, a.shiftId);
    return id;
  });
}

async function createApprovalRequest(db: Db, actor: Actor, ctx: AuditContext, r: { shiftId: string; facilityId: string; employeeId: string; evaluation: Evaluation; note: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(approvalRequests)
      .values({ workflowType: "manual_assignment", facilityId: r.facilityId, subjectType: "shift", subjectId: r.shiftId, employeeId: r.employeeId, requestedBy: actor.userId, payload: { evaluation: r.evaluation.results, note: r.note } })
      .returning({ id: approvalRequests.id });
    await tx.insert(notifications).values({ organizationId: actor.organizationId, category: "approval_requested", title: "Assignment needs approval", body: `${actor.displayName} requested an assignment that needs approval.`, data: { approvalRequestId: row.id, facilityId: r.facilityId } });
    await audit(tx, ctx, { action: "assignment.approval_requested", entityType: "approval_request", entityId: row.id, facilityId: r.facilityId, after: { shiftId: r.shiftId, employeeId: r.employeeId }, reason: r.note || null });
    return row.id;
  });
}

export async function decideApproval(db: Db, actor: Actor, ctx: AuditContext, requestId: string, approve: boolean, reason: string): Promise<AssignResult | null> {
  const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  if (!req || req.status !== "pending" || !req.facilityId || !req.employeeId) throw new NotFoundError("Approval request");
  assertCan(actor, "assignments.approve", { facilityId: req.facilityId });
  if (reason.trim().length < 5) throw new AppError("Please add a short explanation (at least 5 characters).");
  if (!approve) {
    await db.transaction(async (tx) => {
      await tx.update(approvalRequests).set({ status: "rejected", decidedBy: actor.userId, decidedAt: new Date(), decisionReason: reason }).where(eq(approvalRequests.id, requestId));
      await audit(tx, ctx, { action: "assignment.approval_rejected", entityType: "approval_request", entityId: requestId, facilityId: req.facilityId, reason });
    });
    return null;
  }
  // Re-evaluate at decision time: things may have changed since the request.
  const evaluation = await evaluateAssignment(db, { employeeId: req.employeeId, shiftId: req.subjectId });
  const { hardBlocks, overridableBlocks, approvals } = blockingResults(evaluation);
  if (hardBlocks.length) return { status: "blocked", evaluation, message: `Can't approve now: ${hardBlocks.map((r) => r.message).join(" ")}` };
  if (overridableBlocks.length && !can(actor, "rules.override", { facilityId: req.facilityId })) return { status: "needs_override", evaluation, message: "This now needs an override, which you don't have permission for." };
  const assignmentId = await insertAssignment(db, ctx, actor.userId, { shiftId: req.subjectId, employeeId: req.employeeId, facilityId: req.facilityId, evaluation, overridden: [...overridableBlocks, ...approvals], explanation: reason, via: "scheduler", approvedBy: actor.userId });
  await db.update(approvalRequests).set({ status: "approved", decidedBy: actor.userId, decidedAt: new Date(), decisionReason: reason }).where(eq(approvalRequests.id, requestId));
  await audit(db, ctx, { action: "assignment.approval_granted", entityType: "approval_request", entityId: requestId, facilityId: req.facilityId, after: { assignmentId }, reason });
  return { status: "assigned", assignmentId, evaluation, message: "Approved and assigned." };
}

export async function unassign(db: Db, actor: Actor, ctx: AuditContext, assignmentId: string, reason: string) {
  const [a] = await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, assignmentId));
  if (!a || a.status !== "assigned") throw new NotFoundError("Assignment");
  const [s] = await db.select().from(shifts).where(eq(shifts.id, a.shiftId));
  assertCan(actor, "schedules.manage", { facilityId: a.facilityId, departmentId: s?.departmentId ?? undefined });
  await db.transaction(async (tx) => {
    await tx.update(shiftAssignments).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.userId, cancelReason: reason || "Removed by scheduler" }).where(eq(shiftAssignments.id, assignmentId));
    await audit(tx, ctx, { action: "assignment.removed", entityType: "shift_assignment", entityId: assignmentId, facilityId: a.facilityId, before: { employeeId: a.employeeId, shiftId: a.shiftId }, reason: reason || null });
    await refreshShiftMarket(tx, ctx, a.shiftId);
  });
}

export async function pendingApprovals(db: Db, actor: Actor, facilityId: string) {
  if (!can(actor, "schedules.view", { facilityId })) return [];
  return db
    .select({ request: approvalRequests, employeeFirst: employees.firstName, employeeLast: employees.lastName, startsAt: shifts.startsAt, positionCode: positions.code, requestedBy: users.displayName })
    .from(approvalRequests)
    .innerJoin(employees, eq(employees.id, approvalRequests.employeeId))
    .innerJoin(shifts, eq(shifts.id, approvalRequests.subjectId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .leftJoin(users, eq(users.id, approvalRequests.requestedBy))
    .where(and(eq(approvalRequests.facilityId, facilityId), eq(approvalRequests.status, "pending")))
    .orderBy(desc(approvalRequests.createdAt));
}
