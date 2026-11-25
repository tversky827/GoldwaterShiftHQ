"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/action-form";
import { runAction } from "@/server/context";
import { addToPool, placePoolEmployee, poolAddCandidates, poolCandidates } from "@/server/pool";

export interface Candidate {
  employeeId: string;
  name: string;
  outcome: string;
  blocked: boolean;
  needsOverride: boolean;
  needsApproval: boolean;
  messages: { outcome: string; message: string }[];
  hoursAfter: number;
}

export async function candidatesAction(shiftId: string): Promise<{ ok: boolean; message?: string; candidates?: Candidate[] }> {
  let out: Candidate[] = [];
  const r = await runAction(async ({ db, actor }) => {
    out = (await poolCandidates(db, actor, shiftId)).candidates;
  });
  return r.ok ? { ok: true, candidates: out } : { ok: false, message: r.error };
}

export async function placeAction(shiftId: string, employeeId: string, explanation?: string): Promise<{ ok: boolean; status?: string; message: string }> {
  let res: { ok: boolean; status?: string; message: string } = { ok: false, message: "" };
  const r = await runAction(async ({ db, actor, audit }) => {
    const a = await placePoolEmployee(db, actor, audit, { shiftId, employeeId, explanation });
    res = { ok: a.status === "assigned" || a.status === "pending_approval", status: a.status, message: a.message };
  });
  revalidatePath("/pool");
  return r.ok ? res : { ok: false, message: r.error };
}

export async function searchAddCandidatesAction(q: string) {
  let rows: Awaited<ReturnType<typeof poolAddCandidates>> = [];
  await runAction(async ({ db, actor }) => {
    rows = await poolAddCandidates(db, actor, q);
  });
  return rows.map((r) => ({ id: r.id, label: `${r.first} ${r.last}${r.employeeNumber ? ` · #${r.employeeNumber}` : ""}`, detail: [r.position, r.facilityName].filter(Boolean).join(" · ") }));
}

export async function addToPoolAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    const employeeId = String(fd.get("employeeId") ?? "");
    if (!employeeId) return { ok: false, error: "Choose an employee." };
    await addToPool(db, actor, audit, { employeeId, facilityIds: fd.getAll("facilityId").map(String), reason: String(fd.get("reason") ?? "") });
    return { ok: true, message: "Added to the regional pool." };
  });
  revalidatePath("/pool");
  return res;
}
