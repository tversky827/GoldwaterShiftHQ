"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/action-form";
import { runAction } from "@/server/context";
import { authorizeFacility, revokeFacilityAuthorization, setRegionalPool } from "@/server/employees";
import { appBaseUrl } from "@/server/integrations/config";
import { inviteEmployee } from "@/server/users";

export async function setPoolAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("employeeId"));
  const res = await runAction(async ({ db, actor, audit }) => {
    const join = fd.get("pool") === "true";
    await setRegionalPool(db, actor, audit, id, join, String(fd.get("reason") ?? ""));
    return { ok: true, message: join ? "Added to the regional staffing pool." : "Removed from the regional staffing pool." };
  });
  revalidatePath(`/employees/${id}`);
  return res;
}

export async function authorizeFacilityAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("employeeId"));
  const facilityId = String(fd.get("facilityId") ?? "");
  if (!facilityId) return { ok: false, error: "Choose a facility.", fieldErrors: { facilityId: "Choose a facility." } };
  const res = await runAction(async ({ db, actor, audit }) => {
    await authorizeFacility(db, actor, audit, id, facilityId, String(fd.get("reason") ?? ""));
    return { ok: true, message: "Facility authorized." };
  });
  revalidatePath(`/employees/${id}`);
  return res;
}

export async function revokeAuthorizationAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("employeeId"));
  const res = await runAction(async ({ db, actor, audit }) => {
    await revokeFacilityAuthorization(db, actor, audit, String(fd.get("authorizationId")), String(fd.get("reason") ?? "Revoked"));
  });
  revalidatePath(`/employees/${id}`);
  return res;
}

export async function inviteEmployeeAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("employeeId"));
  const res = await runAction(async ({ db, actor, audit }) => {
    const { token } = await inviteEmployee(db, actor, audit, id, String(fd.get("email") ?? ""));
    return { ok: true, message: "Invitation created. Share this link with the employee:", data: { link: `${appBaseUrl()}/invite/${token}` } };
  });
  revalidatePath(`/employees/${id}`);
  return res;
}
