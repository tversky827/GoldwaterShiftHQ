import { Bell, CalendarPlus, Hourglass } from "lucide-react";
import Link from "next/link";
import { getDb } from "@/db";
import { requireActor } from "@/server/context";
import { openShiftsForMe } from "@/server/marketplace/claims";
import { mySwaps } from "@/server/marketplace/swaps";
import { myHome } from "@/server/me";
import { MarkAllRead, SwapRequests } from "./home-actions";
import { NextShiftCard, ShiftRow, shiftTimes } from "./shift-card";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function EmployeeHome() {
  const actor = await requireActor();
  const db = await getDb();
  const [home, open, swaps] = await Promise.all([myHome(db, actor), openShiftsForMe(db, actor), mySwaps(db, actor)]);
  const openCount = open.available.length;
  const when = (x: { startsAt: Date; endsAt: Date; facilityName: string; facilityTimezone: string }) => {
    const t = shiftTimes({ ...x, positionName: "" });
    return `${t.day}, ${t.range}`;
  };
  const first = actor.displayName.split(" ")[0];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[15px] text-muted">{greeting()},</p>
        <h1 className="text-[32px] font-semibold tracking-tight">{first}</h1>
      </header>

      {home.next ? (
        <NextShiftCard s={home.next} />
      ) : (
        <div className="rounded-3xl border border-black/[0.04] bg-surface p-6 shadow-card">
          <div className="text-[13px] font-medium text-muted">Your next shift</div>
          <div className="mt-2 text-[20px] font-semibold tracking-tight">Nothing scheduled yet</div>
          <p className="mt-1 text-[14px] text-muted">When your scheduler publishes your shifts, they’ll appear here.</p>
        </div>
      )}

      <Link href="/app/shifts" className="flex items-center gap-4 rounded-2xl border border-black/[0.04] bg-surface p-4 shadow-card">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <CalendarPlus className="size-5" />
        </span>
        <span className="flex-1">
          <span className="block text-[16px] font-semibold">Pick up a shift</span>
          <span className="block text-[13px] text-muted">{openCount ? `${openCount} open shift${openCount === 1 ? "" : "s"} you’re eligible for` : "No open shifts for you right now"}</span>
        </span>
      </Link>

      <SwapRequests
        items={swaps.map((s) => ({
          id: s.id,
          incoming: s.incoming,
          status: s.status,
          note: s.note,
          title: s.incoming ? `${s.requesterName} wants to swap with you` : `Swap with ${s.targetName}`,
          detail: s.incoming ? `You’d work ${when(s.requesterShift)} instead of ${s.targetShift ? when(s.targetShift) : "—"}.` : `You’d work ${s.targetShift ? when(s.targetShift) : "—"} instead of ${when(s.requesterShift)}.`,
        }))}
      />

      {home.upcoming.length > 0 && (
        <section>
          <h2 className="mb-1 text-[20px] font-semibold tracking-tight">Coming up</h2>
          <div className="divide-y divide-line">
            {home.upcoming.map((s) => (
              <ShiftRow key={s.id} s={s} href={`/app/schedule/${s.id}`} />
            ))}
          </div>
        </section>
      )}

      {home.pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-[20px] font-semibold tracking-tight">Waiting for approval</h2>
          <div className="space-y-2">
            {home.pending.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-caution-soft px-4 py-3 text-[14px] text-caution">
                <Hourglass className="size-4 shrink-0" />
                {p.positionCode} at {p.facilityName}, {shiftTimes({ startsAt: p.startsAt, endsAt: p.startsAt, facilityName: p.facilityName, facilityTimezone: p.facilityTimezone, positionName: "" }).day}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[20px] font-semibold tracking-tight">Notifications</h2>
          {home.notifications.length > 0 && <MarkAllRead />}
        </div>
        {home.notifications.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-fill px-4 py-4 text-[14px] text-muted">
            <Bell className="size-4" /> You’re all caught up.
          </div>
        ) : (
          <ul className="space-y-2">
            {home.notifications.map((n) => (
              <li key={n.id} className="rounded-2xl border border-black/[0.04] bg-surface px-4 py-3 shadow-card">
                <div className="text-[15px] font-medium">{n.title}</div>
                <div className="text-[13px] text-muted">{n.body}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
