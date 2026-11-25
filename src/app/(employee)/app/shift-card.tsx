import { MapPin } from "lucide-react";
import { timezoneShort } from "@/lib/format";

export interface ShiftLike {
  startsAt: Date;
  endsAt: Date;
  facilityName: string;
  facilityTimezone: string;
  positionName: string;
}

export function shiftTimes(s: ShiftLike) {
  const tz = s.facilityTimezone;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz }).format(s.startsAt);
  const t = (d: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  return { day, range: `${t(s.startsAt)} – ${t(s.endsAt)}`, tz: timezoneShort(tz) };
}

export function ShiftRow({ s }: { s: ShiftLike }) {
  const { day, range, tz } = shiftTimes(s);
  return (
    <div className="flex items-center justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <div className="text-[15px] font-medium">{day}</div>
        <div className="truncate text-[13px] text-muted">
          {s.facilityName} · {s.positionName}
        </div>
      </div>
      <div className="tabular shrink-0 text-right text-[14px] text-ink-2">
        {range}
        <div className="text-[11px] text-faint">{tz}</div>
      </div>
    </div>
  );
}

export function NextShiftCard({ s }: { s: ShiftLike }) {
  const { day, range, tz } = shiftTimes(s);
  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#2b8cf0] to-[#0060c7] p-6 text-white shadow-pop">
      <div className="text-[13px] font-medium opacity-80">Your next shift</div>
      <div className="mt-2 text-[26px] font-semibold leading-tight tracking-tight">{day}</div>
      <div className="tabular mt-1 text-[17px] opacity-95">
        {range} <span className="text-[13px] opacity-75">{tz}</span>
      </div>
      <div className="mt-4 flex items-center gap-1.5 text-[14px] opacity-90">
        <MapPin className="size-4" /> {s.facilityName} · {s.positionName}
      </div>
    </div>
  );
}
