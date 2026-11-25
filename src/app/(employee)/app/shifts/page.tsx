import { getDb } from "@/db";
import { requireActor } from "@/server/context";
import { openShiftsForMe } from "@/server/marketplace/claims";
import { shiftTimes } from "../shift-card";
import { PickUpList } from "./pick-up";

export const metadata = { title: "Pick up shifts" };
export const dynamic = "force-dynamic";

export default async function PickUpPage() {
  const actor = await requireActor();
  const data = await openShiftsForMe(await getDb(), actor);
  const t = (s: { startsAt: Date; endsAt: Date; facilityName: string; facilityTimezone: string }) => shiftTimes({ ...s, positionName: "" });
  return (
    <div>
      <h1 className="text-[32px] font-semibold tracking-tight">Pick up shifts</h1>
      <p className="mb-6 mt-1 text-[15px] text-muted">Open shifts you’re qualified and authorized for.</p>
      <PickUpList
        cards={data.available.map((c) => {
          const x = t(c);
          return { listingId: c.listingId, day: x.day, range: x.range, tz: x.tz, facilityName: c.facilityName, positionName: c.positionName, paidHours: c.paidHours, incentiveText: c.incentiveText, isCallout: c.isCallout, open: c.open, mode: c.mode, reasons: c.reasons, warnings: c.warnings, hoursAfter: c.hoursAfter };
        })}
        requested={data.requested.map((r) => {
          const x = t(r);
          return { id: r.id, day: x.day, range: x.range, facilityName: r.facilityName, positionName: r.positionName };
        })}
        full={data.full.map((f) => {
          const x = t(f);
          return { listingId: f.listingId, shiftId: f.shiftId, day: x.day, range: x.range, facilityName: f.facilityName, positionName: f.positionName, onWaitlist: f.onWaitlist };
        })}
      />
    </div>
  );
}
