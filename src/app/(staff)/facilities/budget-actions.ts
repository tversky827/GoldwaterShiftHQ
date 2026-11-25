"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/action-form";
import { runAction } from "@/server/context";
import { budgetTemplateInput, copyBudgetTemplate, createBudgetTemplate, saveBudgetMatrix, updateBudgetTemplate, type MatrixCell } from "@/server/scheduling/budgets";
import { parseForm } from "@/server/validation";

export async function createBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const facilityId = String(fd.get("facilityId"));
  const parsed = parseForm(budgetTemplateInput, fd);
  if (!parsed.ok) return parsed;
  let id = "";
  const r = await runAction(async ({ db, actor, audit }) => {
    id = (await createBudgetTemplate(db, actor, audit, facilityId, parsed.data)).id;
  });
  if (!r.ok) return r;
  redirect(`/facilities/${facilityId}/budgets/${id}`);
}

export async function updateBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const templateId = String(fd.get("templateId"));
  const parsed = parseForm(budgetTemplateInput, fd);
  if (!parsed.ok) return parsed;
  const r = await runAction(async ({ db, actor, audit }) => {
    await updateBudgetTemplate(db, actor, audit, templateId, { ...parsed.data, isActive: fd.get("isActive") === "on" });
    return { ok: true, message: "Budget details saved." };
  });
  revalidatePath(`/facilities/${fd.get("facilityId")}`);
  return r;
}

export async function saveMatrixAction(templateId: string, facilityId: string, cells: MatrixCell[]): Promise<{ ok: boolean; message: string }> {
  const r = await runAction(async ({ db, actor, audit }) => {
    const n = await saveBudgetMatrix(db, actor, audit, templateId, cells);
    return { ok: true, message: n ? `Saved ${n} change${n === 1 ? "" : "s"}. Use “Sync with budget” on the schedule to update existing weeks.` : "No changes to save." };
  });
  revalidatePath(`/facilities/${facilityId}`);
  return r.ok ? { ok: true, message: r.message ?? "Saved." } : { ok: false, message: r.error };
}

export async function copyBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const target = String(fd.get("targetFacilityId") ?? "");
  if (!target) return { ok: false, error: "Choose a facility.", fieldErrors: { targetFacilityId: "Choose a facility." } };
  let dest = "";
  const r = await runAction(async ({ db, actor, audit }) => {
    dest = (await copyBudgetTemplate(db, actor, audit, String(fd.get("templateId")), target, String(fd.get("name") ?? ""))).id;
  });
  if (!r.ok) return r;
  redirect(`/facilities/${target}/budgets/${dest}`);
}
