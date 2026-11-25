"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveAvailabilityAction } from "./actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-1 text-[13px] font-medium uppercase tracking-wide text-faint">{title}</h2>
      {hint && <p className="mb-2 px-1 text-[13px] text-muted">{hint}</p>}
      <div className="rounded-2xl border border-black/[0.04] bg-surface shadow-card">{children}</div>
    </section>
  );
}

export function AvailabilityForm(props: { unavailableDays: number[]; maxWeeklyHours: number | null; preferredShiftCodes: string[]; preferredFacilityIds: string[]; facilities: { id: string; name: string }[]; shiftOptions: { code: string; name: string }[] }) {
  const [off, setOff] = useState(new Set(props.unavailableDays));
  const [shifts, setShifts] = useState(new Set(props.preferredShiftCodes));
  const [facs, setFacs] = useState(new Set(props.preferredFacilityIds));
  const [max, setMax] = useState(props.maxWeeklyHours?.toString() ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const toggle = <T,>(set: Set<T>, v: T, update: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    update(n);
    setMsg(null);
  };

  return (
    <div className="space-y-7">
      <Group title="Days I can work" hint="Tap a day to mark it unavailable.">
        <ul className="divide-y divide-line">
          {DAYS.map((d, i) => (
            <li key={d}>
              <button type="button" onClick={() => toggle(off, i, setOff)} className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px]" aria-pressed={!off.has(i)}>
                <span>{d}</span>
                <span className={cn("rounded-full px-3 py-1 text-[13px] font-medium", off.has(i) ? "bg-fill text-muted" : "bg-positive-soft text-positive")}>{off.has(i) ? "Unavailable" : "Available"}</span>
              </button>
            </li>
          ))}
        </ul>
      </Group>

      {props.shiftOptions.length > 0 && (
        <Group title="Preferred shifts">
          <div className="flex flex-wrap gap-2 p-4">
            {props.shiftOptions.map((s) => (
              <button key={s.code} type="button" onClick={() => toggle(shifts, s.code, setShifts)} className={cn("rounded-full border px-4 py-2 text-[15px] transition-colors", shifts.has(s.code) ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink-2")} aria-pressed={shifts.has(s.code)}>
                {s.name}
              </button>
            ))}
          </div>
        </Group>
      )}

      {props.facilities.length > 1 && (
        <Group title="Preferred facilities">
          <ul className="divide-y divide-line">
            {props.facilities.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => toggle(facs, f.id, setFacs)} className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px]" aria-pressed={facs.has(f.id)}>
                  <span>{f.name}</span>
                  {facs.has(f.id) && <Check className="size-5 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Group>
      )}

      <Group title="Maximum hours per week" hint="Optional. Schedulers see this as a preference.">
        <div className="flex items-center gap-3 p-4">
          <input type="number" inputMode="numeric" min={4} max={84} value={max} onChange={(e) => (setMax(e.target.value), setMsg(null))} placeholder="No limit" className="h-11 w-28 rounded-xl border border-line-strong px-3 text-[17px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15" />
          <span className="text-[15px] text-muted">hours</span>
        </div>
      </Group>

      {msg && <div className={cn("rounded-xl px-4 py-3 text-[14px]", msg.ok ? "bg-positive-soft text-positive" : "bg-critical-soft text-critical")}>{msg.text}</div>}
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveAvailabilityAction({ unavailableDays: [...off], maxWeeklyHours: max ? Number(max) : null, preferredShiftCodes: [...shifts], preferredFacilityIds: [...facs] });
            setMsg({ ok: r.ok, text: r.message });
          })
        }
      >
        {pending ? "Saving…" : "Save availability"}
      </Button>
    </div>
  );
}
