"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/action-form";
import { runAction } from "@/server/context";
import { createPosition, positionInput } from "@/server/facilities";
import { saveMapping, syncNow, testConnection, type Provider } from "@/server/integrations";
import { appBaseUrl } from "@/server/integrations/config";
import { grantRole, inviteUser, inviteUserInput, resendInvitation, revokeRole, setRolePermissions, setUserDisabled } from "@/server/users";
import { parseForm } from "@/server/validation";

export async function inviteUserAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = parseForm(inviteUserInput, fd);
  if (!parsed.ok) return parsed;
  const res = await runAction(async ({ db, actor, audit }) => {
    const { token } = await inviteUser(db, actor, audit, parsed.data);
    return { ok: true, message: "User created. Share this one-time link so they can set a password:", data: { link: `${appBaseUrl()}/invite/${token}` } };
  });
  revalidatePath("/settings/users");
  return res;
}

export async function resendInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    const token = await resendInvitation(db, actor, audit, String(fd.get("userId")));
    return { ok: true, message: "New invitation link (the old one no longer works):", data: { link: `${appBaseUrl()}/invite/${token}` } };
  });
  return res;
}

export async function grantRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await grantRole(db, actor, audit, String(fd.get("userId")), String(fd.get("roleId")), String(fd.get("scopeType")), String(fd.get("facilityId") || "") || undefined, String(fd.get("departmentId") || "") || undefined);
    return { ok: true, message: "Role added." };
  });
  revalidatePath("/settings/users");
  return res;
}

export async function revokeRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await revokeRole(db, actor, audit, String(fd.get("userRoleId")));
  });
  revalidatePath("/settings/users");
  return res;
}

export async function setUserDisabledAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await setUserDisabled(db, actor, audit, String(fd.get("userId")), fd.get("disabled") === "true");
  });
  revalidatePath("/settings/users");
  return res;
}

export async function setRolePermissionsAction(_: FormState, fd: FormData): Promise<FormState> {
  const roleId = String(fd.get("roleId"));
  const res = await runAction(async ({ db, actor, audit }) => {
    await setRolePermissions(db, actor, audit, roleId, fd.getAll("permission").map(String));
    return { ok: true, message: "Permissions saved. They apply the next time each user loads a page." };
  });
  revalidatePath("/settings/roles");
  return res;
}

export async function testConnectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const provider = String(fd.get("provider")) as Provider;
  const res = await runAction(async ({ db, actor, audit }) => {
    const r = await testConnection(db, actor, audit, provider);
    const details = r.details ? ` ${Object.entries(r.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") || "none" : String(v)}`).join(" · ")}` : "";
    return r.ok ? { ok: true, message: r.message + details } : { ok: false, error: r.message + details };
  });
  revalidatePath("/settings/integrations");
  return res;
}

export async function syncNowAction(_: FormState, fd: FormData): Promise<FormState> {
  const provider = String(fd.get("provider")) as Provider;
  const res = await runAction(async ({ db, actor, audit }) => {
    const r = await syncNow(db, actor, audit, provider);
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  });
  revalidatePath("/settings/integrations");
  revalidatePath("/employees");
  return res;
}

export async function saveMappingAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await saveMapping(db, actor, audit, {
      provider: (String(fd.get("provider") || "paycor") as Provider),
      sourceType: String(fd.get("sourceType")) as "location" | "legal_entity" | "department" | "position",
      sourceValue: String(fd.get("sourceValue") ?? ""),
      facilityId: String(fd.get("facilityId") || "") || null,
      departmentId: String(fd.get("departmentId") || "") || null,
      positionId: String(fd.get("positionId") || "") || null,
    });
    return { ok: true, message: "Mapping saved. It applies on the next sync." };
  });
  revalidatePath("/settings/integrations");
  return res;
}

export async function createPositionAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = parseForm(positionInput, fd);
  if (!parsed.ok) return parsed;
  const res = await runAction(async ({ db, actor, audit }) => {
    await createPosition(db, actor, audit, parsed.data);
    return { ok: true, message: "Classification added." };
  });
  revalidatePath("/settings/classifications");
  return res;
}

export async function updateRuleAction(_: FormState, fd: FormData): Promise<FormState> {
  const { updateRule, PARAM_FIELDS } = await import("@/server/scheduling/rule-settings");
  const ruleType = String(fd.get("ruleType"));
  const params: Record<string, string> = {};
  for (const f of PARAM_FIELDS[ruleType] ?? []) params[f.key] = String(fd.get(`param:${f.key}`) ?? "");
  const res = await runAction(async ({ db, actor, audit }) => {
    await updateRule(db, actor, audit, String(fd.get("ruleId")), { outcome: String(fd.get("outcome")) as "warning", overridable: fd.get("overridable") === "on", isActive: fd.get("isActive") === "on", params });
    return { ok: true, message: "Saved. This rule now needs to be confirmed again." };
  });
  revalidatePath("/settings/rules");
  return res;
}

export async function customizeRuleAction(_: FormState, fd: FormData): Promise<FormState> {
  const { customizeForFacility } = await import("@/server/scheduling/rule-settings");
  const res = await runAction(async ({ db, actor, audit }) => {
    await customizeForFacility(db, actor, audit, String(fd.get("ruleId")), String(fd.get("facilityId")));
  });
  revalidatePath("/settings/rules");
  return res;
}

export async function removeFacilityRuleAction(_: FormState, fd: FormData): Promise<FormState> {
  const { removeFacilityRule } = await import("@/server/scheduling/rule-settings");
  const res = await runAction(async ({ db, actor, audit }) => {
    await removeFacilityRule(db, actor, audit, String(fd.get("ruleId")));
  });
  revalidatePath("/settings/rules");
  return res;
}

export async function updateOvertimeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { updateOvertimeRule } = await import("@/server/scheduling/rule-settings");
  const res = await runAction(async ({ db, actor, audit }) => {
    await updateOvertimeRule(db, actor, audit, {
      weeklyThresholdHours: String(fd.get("weeklyThresholdHours") ?? ""),
      warningAtHours: String(fd.get("warningAtHours") ?? ""),
      workweekStartDay: Number(fd.get("workweekStartDay")),
      outcome: String(fd.get("outcome")) as "warning",
      overridable: fd.get("overridable") === "on",
    });
    return { ok: true, message: "Overtime rule saved. It now needs to be confirmed again." };
  });
  revalidatePath("/settings/rules");
  return res;
}

export async function confirmRulesAction(_: FormState, fd: FormData): Promise<FormState> {
  const { confirmRules } = await import("@/server/scheduling/rule-settings");
  const res = await runAction(async ({ db, actor, audit }) => {
    await confirmRules(db, actor, audit, String(fd.get("statement") ?? ""));
    return { ok: true, message: "Rules confirmed. The warning banner is removed from schedules." };
  });
  revalidatePath("/settings/rules");
  revalidatePath("/schedule");
  return res;
}
