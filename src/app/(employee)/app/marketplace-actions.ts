"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/context";
import { recordCallout } from "@/server/marketplace/callouts";
import { claimShift, joinWaitlist, leaveWaitlist, withdrawClaim } from "@/server/marketplace/claims";
import { cancelSwap, requestSwap, respondToSwap } from "@/server/marketplace/swaps";
import { markRead } from "@/server/notifications";

export interface EmployeeResult {
  ok: boolean;
  status?: string;
  message: string;
}

const refresh = () => {
  revalidatePath("/app", "layout");
};

async function run(fn: Parameters<typeof runAction>[0]): Promise<EmployeeResult> {
  const r = await runAction(fn);
  refresh();
  return r.ok ? { ok: true, status: (r.data as { status?: string } | undefined)?.status, message: r.message ?? "Done." } : { ok: false, message: r.error };
}

export async function pickUpAction(listingId: string) {
  return run(async ({ db, actor, audit }) => {
    const r = await claimShift(db, actor, audit, listingId);
    if (r.status === "blocked") return { ok: false, error: r.message };
    return { ok: true, message: r.message, data: { status: r.status } };
  });
}

export async function cancelRequestAction(claimId: string) {
  return run(async ({ db, actor, audit }) => {
    await withdrawClaim(db, actor, audit, claimId);
    return { ok: true, message: "Request cancelled." };
  });
}

export async function joinWaitlistAction(listingId: string) {
  return run(async ({ db, actor, audit }) => {
    await joinWaitlist(db, actor, audit, listingId);
    return { ok: true, message: "You're on the waitlist. We'll notify you if a spot opens." };
  });
}

export async function leaveWaitlistAction(shiftId: string) {
  return run(async ({ db, actor, audit }) => {
    await leaveWaitlist(db, actor, audit, shiftId);
    return { ok: true, message: "Removed from the waitlist." };
  });
}

export async function requestSwapAction(myAssignmentId: string, targetAssignmentId: string, note: string) {
  return run(async ({ db, actor, audit }) => {
    await requestSwap(db, actor, audit, { myAssignmentId, targetAssignmentId, note });
    return { ok: true, message: "Swap requested. Your colleague will be asked first, then a manager." };
  });
}

export async function respondSwapAction(swapId: string, accept: boolean) {
  return run(async ({ db, actor, audit }) => {
    await respondToSwap(db, actor, audit, swapId, accept);
    return { ok: true, message: accept ? "Accepted. A manager will approve it next." : "Declined." };
  });
}

export async function cancelSwapAction(swapId: string) {
  return run(async ({ db, actor, audit }) => {
    await cancelSwap(db, actor, audit, swapId);
    return { ok: true, message: "Swap request cancelled." };
  });
}

export async function calloutAction(assignmentId: string, reason: string) {
  return run(async ({ db, actor, audit }) => {
    await recordCallout(db, actor, audit, assignmentId, reason);
    return { ok: true, message: "Thanks for letting us know. Your manager has been notified and the shift is posted for coverage." };
  });
}

export async function markAllReadAction() {
  return run(async ({ db, actor }) => {
    await markRead(db, actor);
    return { ok: true, message: "All caught up." };
  });
}
