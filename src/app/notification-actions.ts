"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/action-form";
import { runAction } from "@/server/context";
import { saveMyNotificationSettings } from "@/server/notifications";

export async function saveMyNotificationsAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await saveMyNotificationSettings(db, actor, audit, { emailEnabled: fd.get("emailEnabled") === "on", smsEnabled: fd.get("smsEnabled") === "on", mobilePhone: String(fd.get("mobilePhone") ?? "") });
    return { ok: true, message: "Saved." };
  });
  revalidatePath("/app/profile");
  revalidatePath("/settings/notifications");
  return res;
}
