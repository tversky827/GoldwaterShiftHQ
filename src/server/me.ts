/** Employee self-service reads. Always scoped to the signed-in employee only. */
import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db";
import { facilities, notifications, positions, shiftAssignments, shiftClaims, shifts } from "@/db/schema";
import { ForbiddenError } from "./errors";
import type { Actor } from "./rbac/access";

function employeeIdOf(actor: Actor): string {
  if (!actor.employeeId) throw new ForbiddenError("This account isn't linked to an employee record.");
  return actor.employeeId;
}

const assignmentCols = {
  id: shiftAssignments.id,
  startsAt: shiftAssignments.startsAt,
  endsAt: shiftAssignments.endsAt,
  status: shiftAssignments.status,
  facilityName: facilities.name,
  facilityTimezone: facilities.timezone,
  facilityCity: facilities.city,
  positionName: positions.name,
  positionCode: positions.code,
};

export async function mySchedule(db: Db, actor: Actor, opts: { past?: boolean; limit?: number } = {}) {
  const employeeId = employeeIdOf(actor);
  const now = new Date();
  return db
    .select(assignmentCols)
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .innerJoin(facilities, eq(facilities.id, shiftAssignments.facilityId))
    .innerJoin(positions, eq(positions.id, shifts.positionId))
    .where(
      and(
        eq(shiftAssignments.employeeId, employeeId),
        opts.past ? lt(shiftAssignments.endsAt, now) : gte(shiftAssignments.endsAt, now),
        opts.past ? inArray(shiftAssignments.status, ["assigned", "completed"]) : eq(shiftAssignments.status, "assigned"),
      ),
    )
    .orderBy(opts.past ? desc(shiftAssignments.startsAt) : asc(shiftAssignments.startsAt))
    .limit(opts.limit ?? 30);
}

export async function myHome(db: Db, actor: Actor) {
  const employeeId = employeeIdOf(actor);
  const [upcoming, pending, notes] = await Promise.all([
    mySchedule(db, actor, { limit: 6 }),
    db
      .select({ id: shiftClaims.id, createdAt: shiftClaims.createdAt, startsAt: shifts.startsAt, facilityName: facilities.name, facilityTimezone: facilities.timezone, positionCode: positions.code })
      .from(shiftClaims)
      .innerJoin(shifts, eq(shifts.id, shiftClaims.shiftId))
      .innerJoin(facilities, eq(facilities.id, shifts.facilityId))
      .innerJoin(positions, eq(positions.id, shifts.positionId))
      .where(and(eq(shiftClaims.employeeId, employeeId), eq(shiftClaims.status, "pending")))
      .orderBy(asc(shifts.startsAt)),
    db
      .select()
      .from(notifications)
      .where(and(or(eq(notifications.employeeId, employeeId), eq(notifications.userId, actor.userId)), eq(notifications.channel, "in_app"), isNull(notifications.readAt)))
      .orderBy(desc(notifications.createdAt))
      .limit(5),
  ]);
  return { next: upcoming[0] ?? null, upcoming: upcoming.slice(1), pending, notifications: notes };
}
