import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { AppError } from "@/server/errors";
import { requireActor } from "@/server/context";
import { mySwaps, swapOptions } from "@/server/marketplace/swaps";
import { NextShiftCard, shiftTimes } from "../../shift-card";
import { ShiftActions } from "./shift-actions";

export const metadata = { title: "Shift" };
export const dynamic = "force-dynamic";

export default async function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const db = await getDb();
  let data: Awaited<ReturnType<typeof swapOptions>>;
  try {
    data = await swapOptions(db, actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const swaps = await mySwaps(db, actor);
  const pending = swaps.some((s) => !s.incoming && s.requesterAssignmentId === data.mine.id);
  const m = data.mine;
  return (
    <div className="space-y-6">
      <Link href="/app/schedule" className="-ml-1 inline-flex min-h-11 items-center gap-1 px-1 text-[15px] text-accent">
        <ChevronLeft className="size-4" /> Schedule
      </Link>
      <NextShiftCard s={{ startsAt: m.startsAt, endsAt: m.endsAt, facilityName: m.facilityName, facilityTimezone: m.facilityTimezone, positionName: m.positionCode }} label="Your shift" />
      <ShiftActions
        assignmentId={m.id}
        swapPending={pending}
        startsSoon={m.startsAt.getTime() - Date.now() < 4 * 3_600_000}
        options={data.options.map((o) => {
          const t = shiftTimes({ startsAt: o.startsAt, endsAt: o.endsAt, facilityName: m.facilityName, facilityTimezone: m.facilityTimezone, positionName: "" });
          return { id: o.id, day: t.day, range: `${t.range} ${t.tz}`, name: o.name };
        })}
      />
    </div>
  );
}
