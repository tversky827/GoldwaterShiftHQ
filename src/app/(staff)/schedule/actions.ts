"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/context";
import { addDaysStr } from "@/lib/tz";
import { assignEmployee, decideApproval, unassign } from "@/server/scheduling/assignments";
import { addManualShift, adjustRequired, copyWeek, ensureWeek, publishWeek } from "@/server/scheduling/schedules";

export interface BoardResult {
  ok: boolean;
  status?: string;
  message: string;
  results?: { name: string; outcome: string; message: string; overridable: boolean }[];
  hours?: { projected: number; after: number; threshold: number | null };
}

const done = (r: Awaited<ReturnType<typeof runAction>>): BoardResult => (r.ok ? { ok: true, message: r.message ?? "Done." } : { ok: false, message: r.error });

export async function generateWeekAction(facilityId: string, weekStart: string, weeks = 1): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    let created = 0;
    for (let i = 0; i < Math.min(Math.max(weeks, 1), 8); i++) created += (await ensureWeek(db, actor, audit, facilityId, addDaysStr(weekStart, i * 7))).created;
    return { ok: true, message: created ? `Created ${created} budgeted shifts${weeks > 1 ? ` across ${weeks} weeks` : ""}.` : "Schedule is up to date with the budget." };
  });
  revalidatePath("/schedule");
  return done(r);
}

export async function assignAction(shiftId: string, employeeId: string, explanation?: string): Promise<BoardResult> {
  let out: BoardResult = { ok: false, message: "" };
  const r = await runAction(async ({ db, actor, audit }) => {
    const res = await assignEmployee(db, actor, audit, { shiftId, employeeId, explanation });
    out = {
      ok: res.status === "assigned" || res.status === "pending_approval",
      status: res.status,
      message: res.message,
      results: res.evaluation.results.map((x) => ({ name: x.name, outcome: x.outcome, message: x.message, overridable: x.overridable })),
      hours: { projected: res.evaluation.hours.projected, after: res.evaluation.hours.afterAssignment, threshold: res.evaluation.hours.overtimeThreshold },
    };
  });
  revalidatePath("/schedule");
  return r.ok ? out : { ok: false, message: r.error };
}

export async function unassignAction(assignmentId: string): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    await unassign(db, actor, audit, assignmentId, "Removed from schedule");
    return { ok: true, message: "Removed. The opening is available again." };
  });
  revalidatePath("/schedule");
  return done(r);
}

export async function adjustOpeningsAction(shiftId: string, delta: number): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    await adjustRequired(db, actor, audit, shiftId, delta);
    return { ok: true, message: delta > 0 ? "Opening added." : "Opening removed." };
  });
  revalidatePath("/schedule");
  return done(r);
}

export async function copyWeekAction(facilityId: string, fromWeek: string, toWeek: string): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    const res = await copyWeek(db, actor, audit, facilityId, fromWeek, toWeek);
    return { ok: true, message: `Copied ${res.copied} assignment${res.copied === 1 ? "" : "s"}.${res.skipped.length ? ` ${res.skipped.length} skipped because rules or coverage didn't allow them; review those openings.` : ""}` };
  });
  revalidatePath("/schedule");
  return done(r);
}

export async function repeatWeekAction(facilityId: string, weekStart: string, weeks: number): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    let copied = 0;
    let skipped = 0;
    for (let i = 1; i <= Math.min(Math.max(weeks, 1), 8); i++) {
      const res = await copyWeek(db, actor, audit, facilityId, weekStart, addDaysStr(weekStart, i * 7));
      copied += res.copied;
      skipped += res.skipped.length;
    }
    return { ok: true, message: `Repeated this week for ${weeks} week${weeks > 1 ? "s" : ""}: ${copied} assignments copied${skipped ? `, ${skipped} skipped by rules` : ""}.` };
  });
  revalidatePath("/schedule");
  return done(r);
}

export async function publishAction(scheduleId: string): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    const res = await publishWeek(db, actor, audit, scheduleId);
    return { ok: true, message: `Published. ${res.notified} employee${res.notified === 1 ? "" : "s"} notified in the app.` };
  });
  revalidatePath("/schedule");
  return done(r);
}

export async function decideApprovalAction(requestId: string, approve: boolean, reason: string): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    const res = await decideApproval(db, actor, audit, requestId, approve, reason);
    if (res && res.status !== "assigned") return { ok: false, error: res.message };
    return { ok: true, message: res ? res.message : "Request declined." };
  });
  revalidatePath("/schedule");
  return done(r);
}

export async function addShiftAction(scheduleId: string, shiftTemplateId: string, positionId: string, date: string, count: number): Promise<BoardResult> {
  const r = await runAction(async ({ db, actor, audit }) => {
    await addManualShift(db, actor, audit, { scheduleId, shiftTemplateId, positionId, date, count });
    return { ok: true, message: "Shift added." };
  });
  revalidatePath("/schedule");
  return done(r);
}
