"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/action-form";
import { runAction } from "@/server/context";
import {
  addDepartment,
  addShiftTemplate,
  addUnit,
  createFacility,
  departmentInput,
  facilityInput,
  setDepartmentActive,
  setFacilityPositions,
  setShiftTemplateActive,
  shiftTemplateInput,
  unitInput,
  updateFacility,
} from "@/server/facilities";
import { parseForm } from "@/server/validation";

export async function createFacilityAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = parseForm(facilityInput, fd);
  if (!parsed.ok) return parsed;
  let id = "";
  const res = await runAction(async ({ db, actor, audit }) => {
    id = (await createFacility(db, actor, audit, parsed.data)).id;
  });
  if (!res.ok) return res;
  revalidatePath("/facilities");
  redirect(`/facilities/${id}`);
}

export async function updateFacilityAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("facilityId"));
  const parsed = parseForm(facilityInput, fd);
  if (!parsed.ok) return parsed;
  const res = await runAction(async ({ db, actor, audit }) => {
    await updateFacility(db, actor, audit, id, { ...parsed.data, isActive: fd.get("isActive") === "on" });
  });
  if (!res.ok) return res;
  revalidatePath(`/facilities/${id}`);
  redirect(`/facilities/${id}`);
}

export async function addDepartmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const facilityId = String(fd.get("facilityId"));
  const parsed = parseForm(departmentInput, fd);
  if (!parsed.ok) return parsed;
  const res = await runAction(async ({ db, actor, audit }) => {
    await addDepartment(db, actor, audit, facilityId, parsed.data);
    return { ok: true, message: "Department added." };
  });
  revalidatePath(`/facilities/${facilityId}`);
  return res;
}

export async function toggleDepartmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await setDepartmentActive(db, actor, audit, String(fd.get("departmentId")), fd.get("active") === "true");
  });
  revalidatePath(`/facilities/${fd.get("facilityId")}`);
  return res;
}

export async function addUnitAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = parseForm(unitInput, fd);
  if (!parsed.ok) return parsed;
  const res = await runAction(async ({ db, actor, audit }) => {
    await addUnit(db, actor, audit, String(fd.get("departmentId")), parsed.data);
    return { ok: true, message: "Unit added." };
  });
  revalidatePath(`/facilities/${fd.get("facilityId")}`);
  return res;
}

export async function setPositionsAction(_: FormState, fd: FormData): Promise<FormState> {
  const facilityId = String(fd.get("facilityId"));
  const res = await runAction(async ({ db, actor, audit }) => {
    await setFacilityPositions(db, actor, audit, facilityId, fd.getAll("positionId").map(String));
    return { ok: true, message: "Job classifications updated." };
  });
  revalidatePath(`/facilities/${facilityId}`);
  return res;
}

export async function addShiftTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  const facilityId = String(fd.get("facilityId"));
  const parsed = parseForm(shiftTemplateInput, fd);
  if (!parsed.ok) return parsed;
  const res = await runAction(async ({ db, actor, audit }) => {
    await addShiftTemplate(db, actor, audit, facilityId, parsed.data);
    return { ok: true, message: "Shift added." };
  });
  revalidatePath(`/facilities/${facilityId}`);
  return res;
}

export async function toggleShiftTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await setShiftTemplateActive(db, actor, audit, String(fd.get("templateId")), fd.get("active") === "true");
  });
  revalidatePath(`/facilities/${fd.get("facilityId")}`);
  return res;
}
