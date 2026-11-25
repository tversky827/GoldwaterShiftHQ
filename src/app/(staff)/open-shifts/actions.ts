"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/action-form";
import { zonedToUtc } from "@/lib/tz";
import { runAction } from "@/server/context";
import { recordCallout } from "@/server/marketplace/callouts";
import { reviewClaim } from "@/server/marketplace/claims";
import { publishOpenShifts, withdrawListing } from "@/server/marketplace/listings";
import { resetFacilityMarketplaceSettings, saveMarketplaceSettings } from "@/server/marketplace/settings";
import { decideSwap } from "@/server/marketplace/swaps";

const refresh = () => {
  revalidatePath("/open-shifts");
  revalidatePath("/schedule");
};

export async function publishAction(_: FormState, fd: FormData): Promise<FormState> {
  const shiftIds = fd.getAll("shiftId").map(String).filter(Boolean);
  const when = String(fd.get("when") ?? "now");
  const tz = String(fd.get("timezone") ?? "UTC");
  const res = await runAction(async ({ db, actor, audit }) => {
    let publishAt: Date | null = null;
    if (when === "later") {
      const d = String(fd.get("publishDate") ?? "");
      const t = String(fd.get("publishTime") ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return { ok: false, error: "Choose the date and time to publish." };
      publishAt = zonedToUtc(d, t, tz);
      if (publishAt <= new Date()) return { ok: false, error: "The publish time is in the past. Choose a later time, or publish now." };
    }
    const close = String(fd.get("expiryHoursBefore") ?? "");
    const r = await publishOpenShifts(db, actor, audit, {
      shiftIds,
      publishAt,
      expiryHoursBefore: close === "" ? null : Number(close),
      requiresApproval: fd.get("requiresApproval") === "on",
      audience: fd.get("audience") === "home" ? "home" : "authorized",
      incentiveText: String(fd.get("incentiveText") ?? ""),
    });
    const parts = [];
    if (r.published) parts.push(`Published ${r.published} shift${r.published === 1 ? "" : "s"}; ${r.notified} employee${r.notified === 1 ? "" : "s"} notified`);
    if (r.scheduled) parts.push(`${r.scheduled} scheduled to publish later`);
    if (r.skipped.length) parts.push(`${r.skipped.length} skipped (${[...new Set(r.skipped.map((s) => s.reason.replace(/\.$/, "").toLowerCase()))].join("; ")})`);
    if (!r.published && !r.scheduled) return { ok: false, error: parts.join(". ") + "." };
    return { ok: true, message: parts.join(". ") + "." };
  });
  refresh();
  return res;
}

export async function withdrawAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await withdrawListing(db, actor, audit, String(fd.get("listingId")), String(fd.get("reason") ?? ""));
    return { ok: true, message: "Withdrawn. Anyone who had asked for it was told." };
  });
  refresh();
  return res;
}

export async function reviewClaimAction(_: FormState, fd: FormData): Promise<FormState> {
  const approve = fd.get("decision") === "approve";
  const res = await runAction(async ({ db, actor, audit }) => {
    const r = await reviewClaim(db, actor, audit, String(fd.get("claimId")), approve, String(fd.get("reason") ?? ""));
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  });
  refresh();
  return res;
}

export async function decideSwapAction(_: FormState, fd: FormData): Promise<FormState> {
  const approve = fd.get("decision") === "approve";
  const res = await runAction(async ({ db, actor, audit }) => {
    const r = await decideSwap(db, actor, audit, String(fd.get("swapId")), approve, String(fd.get("reason") ?? ""));
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  });
  refresh();
  return res;
}

export async function recordCalloutAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    const r = await recordCallout(db, actor, audit, String(fd.get("assignmentId") ?? ""), String(fd.get("reason") ?? ""));
    return { ok: true, message: r.listingId ? `Callout recorded. The shift is posted and ${r.notified} qualified employee${r.notified === 1 ? " was" : "s were"} notified.` : "Callout recorded." };
  });
  refresh();
  return res;
}

export async function saveMarketplaceSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const facilityId = String(fd.get("facilityId") ?? "") || null;
  const res = await runAction(async ({ db, actor, audit }) => {
    await saveMarketplaceSettings(db, actor, audit, facilityId, {
      autoPublish: fd.get("autoPublish") === "on",
      autoPublishHoursBefore: Number(fd.get("autoPublishHoursBefore")),
      expiryHoursBefore: Number(fd.get("expiryHoursBefore")),
      requireApproval: fd.get("requireApproval") === "on",
      escalationMinutes: [Number(fd.get("escalate1")), Number(fd.get("escalate2"))],
    });
    return { ok: true, message: "Saved." };
  });
  revalidatePath("/settings/marketplace");
  return res;
}

export async function resetMarketplaceSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const res = await runAction(async ({ db, actor, audit }) => {
    await resetFacilityMarketplaceSettings(db, actor, audit, String(fd.get("facilityId")));
    return { ok: true, message: "This facility now follows the organization default." };
  });
  revalidatePath("/settings/marketplace");
  return res;
}
