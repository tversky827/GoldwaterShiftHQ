import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { cn } from "@/lib/utils";
import { requireActor } from "@/server/context";
import { mySchedule } from "@/server/me";
import { ShiftRow } from "../shift-card";

export const metadata = { title: "My schedule" };
export const dynamic = "force-dynamic";

export default async function MySchedulePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requireActor();
  const { view } = await searchParams;
  const past = view === "past";
  const rows = await mySchedule(await getDb(), actor, { past, limit: 60 });
  return (
    <div>
      <h1 className="text-[32px] font-semibold tracking-tight">My schedule</h1>
      <div className="mt-4 inline-flex rounded-full bg-fill p-1 text-[14px]">
        {[
          { k: "upcoming", l: "Upcoming" },
          { k: "past", l: "Past" },
        ].map((t) => (
          <Link key={t.k} href={`/app/schedule${t.k === "past" ? "?view=past" : ""}`} className={cn("rounded-full px-4 py-1.5", (t.k === "past") === past ? "bg-surface font-medium shadow-card" : "text-ink-2")}>
            {t.l}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={past ? "No past shifts" : "No upcoming shifts"} description={past ? "Shifts you’ve worked will appear here." : "Published shifts will appear here as soon as your scheduler assigns them."} />
      ) : (
        <div className="mt-4 divide-y divide-line">
          {rows.map((s) => (
            <ShiftRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
