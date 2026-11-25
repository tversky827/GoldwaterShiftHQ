"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/context";
import { saveMyAvailability } from "@/server/me";

export async function saveAvailabilityAction(input: { unavailableDays: number[]; maxWeeklyHours: number | null; preferredShiftCodes: string[]; preferredFacilityIds: string[] }) {
  const r = await runAction(async ({ db, actor, audit }) => {
    await saveMyAvailability(db, actor, audit, input);
    return { ok: true, message: "Saved. Your schedulers will see this when planning." };
  });
  revalidatePath("/app/availability");
  return r.ok ? { ok: true, message: r.message ?? "Saved." } : { ok: false, message: r.error };
}
