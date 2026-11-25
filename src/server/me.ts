/** Employee self-service reads. Always scoped to the signed-in employee only. */
import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db";
import { employeeAvailability, employeeFacilityAuthorizations, employeePreferences, employees, facilities, notifications, positions, shiftAssignments, shiftClaims, shifts, shiftTemplates } from "@/db/schema";
import { audit, type AuditContext } from "./audit";
import { AppError, ForbiddenError } from "./errors";
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

/* ------------------------------------------------------------ availability */

export async function myAvailability(db: Db, actor: Actor) {
  const employeeId = employeeIdOf(actor);
  const [emp] = await db.select({ home: employees.homeFacilityId }).from(employees).where(eq(employees.id, employeeId));
  const auth = await db.select({ f: employeeFacilityAuthorizations.facilityId }).from(employeeFacilityAuthorizations).where(and(eq(employeeFacilityAuthorizations.employeeId, employeeId), isNull(employeeFacilityAuthorizations.revokedAt)));
  const facIds = [...new Set([emp?.home, ...auth.map((a) => a.f)].filter((x): x is string => !!x))];
  const [rows, [prefs], facs, templates] = await Promise.all([
    db.select().from(employeeAvailability).where(and(eq(employeeAvailability.employeeId, employeeId), eq(employeeAvailability.kind, "unavailable"))),
    db.select().from(employeePreferences).where(eq(employeePreferences.employeeId, employeeId)),
    facIds.length ? db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(inArray(facilities.id, facIds)) : Promise.resolve([]),
    facIds.length ? db.selectDistinct({ code: shiftTemplates.code, name: shiftTemplates.name }).from(shiftTemplates).where(and(inArray(shiftTemplates.facilityId, facIds), eq(shiftTemplates.isActive, true))) : Promise.resolve([]),
  ]);
  return {
    unavailableDays: rows.filter((r) => r.dayOfWeek !== null && !r.startTime).map((r) => r.dayOfWeek!) as number[],
    maxWeeklyHours: prefs?.maxWeeklyHours ? Number(prefs.maxWeeklyHours) : null,
    preferredShiftCodes: prefs?.preferredShiftTemplateCodes ?? [],
    preferredFacilityIds: prefs?.preferredFacilityIds ?? [],
    facilities: facs,
    shiftOptions: [...new Map(templates.map((t) => [t.code, t])).values()],
  };
}

export async function saveMyAvailability(db: Db, actor: Actor, ctx: AuditContext, input: { unavailableDays: number[]; maxWeeklyHours: number | null; preferredShiftCodes: string[]; preferredFacilityIds: string[] }) {
  const employeeId = employeeIdOf(actor);
  const days = [...new Set(input.unavailableDays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (input.maxWeeklyHours !== null && !(input.maxWeeklyHours >= 4 && input.maxWeeklyHours <= 84)) throw new AppError("Maximum weekly hours should be between 4 and 84.");
  const allowed = new Set((await myAvailability(db, actor)).facilities.map((f) => f.id));
  await db.transaction(async (tx) => {
    await tx.delete(employeeAvailability).where(and(eq(employeeAvailability.employeeId, employeeId), eq(employeeAvailability.kind, "unavailable"), isNull(employeeAvailability.specificDate)));
    if (days.length) await tx.insert(employeeAvailability).values(days.map((d) => ({ employeeId, kind: "unavailable" as const, dayOfWeek: d })));
    const prefs = {
      maxWeeklyHours: input.maxWeeklyHours === null ? null : String(input.maxWeeklyHours),
      preferredShiftTemplateCodes: input.preferredShiftCodes.slice(0, 10),
      preferredFacilityIds: input.preferredFacilityIds.filter((f) => allowed.has(f)),
    };
    await tx.insert(employeePreferences).values({ employeeId, ...prefs }).onConflictDoUpdate({ target: employeePreferences.employeeId, set: prefs });
    await audit(tx, ctx, { action: "employee.availability_updated", entityType: "employee", entityId: employeeId, after: { unavailableDays: days, ...prefs } });
  });
}
