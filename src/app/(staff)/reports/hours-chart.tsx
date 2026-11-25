"use client";

import { useState } from "react";

/**
 * Budget vs scheduled vs clocked hours by facility: grouped horizontal bars.
 * Categorical slots 1–3 of the validated reference palette (light mode; the
 * app has no dark theme). Two of the three sit below 3:1 contrast on white, so
 * the chart always ships next to the full table view (relief rule).
 */
const SERIES = [
  { key: "budget", label: "Budget", color: "#257de0" },
  { key: "scheduled", label: "Scheduled", color: "#f47230" },
  { key: "clocked", label: "Clocked", color: "#00b894" },
] as const;

export interface HoursRow {
  code: string;
  name: string;
  budget: number;
  scheduled: number;
  clocked: number;
}

/** Smallest "round" axis (4–5 equal steps of 1/2/2.5/5 × 10^k) that holds the largest value. */
const niceAxis = (max: number) => {
  if (max <= 0) return { top: 10, step: 2.5 };
  for (let k = Math.floor(Math.log10(max)) - 1; ; k++) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** k;
      const n = Math.ceil(max / step);
      if (n <= 5) return { top: Math.max(n, 4) * step, step };
    }
  }
};
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function HoursChart({ rows, showClocked }: { rows: HoursRow[]; showClocked: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = SERIES.filter((s) => showClocked || s.key !== "clocked");
  const { top, step } = niceAxis(Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key]))));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  return (
    <figure className="px-6 pb-6 pt-2">
      <figcaption className="sr-only">Budget, scheduled and clocked hours by facility. The table below has the same figures.</figcaption>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-2" aria-hidden>
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="text-faint">Hours</span>
      </div>
      <div className="relative">
        {/* gridlines + axis */}
        <div className="pointer-events-none absolute inset-y-0 left-[72px] right-2">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${(t / top) * 100}%` }}>
              <span className="tabular absolute -bottom-5 -translate-x-1/2 text-[11px] text-faint">{fmt(t)}</span>
            </div>
          ))}
        </div>
        <ul className="relative space-y-3 pb-6">
          {rows.map((r, i) => (
            <li key={r.code} className="relative flex items-center gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${r.name}: ${series.map((s) => `${s.label} ${fmt(r[s.key])} hours`).join(", ")}`}>
              <span className="w-[60px] shrink-0 text-right text-[13px] font-medium text-ink-2">{r.code}</span>
              <span className="flex flex-1 flex-col gap-[2px] py-1 pr-2">
                {series.map((s) => (
                  <span key={s.key} className="block h-2 rounded-r-[4px] transition-opacity" style={{ width: `${Math.max(0, (r[s.key] / top) * 100)}%`, background: s.color, opacity: hover === null || hover === i ? 1 : 0.35 }} />
                ))}
              </span>
              {hover === i && (
                <span role="tooltip" className="absolute left-[76px] top-full z-10 mt-1 min-w-48 rounded-xl border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
                  <span className="mb-1 block font-medium text-ink">{r.name}</span>
                  {series.map((s) => (
                    <span key={s.key} className="flex items-center justify-between gap-4 text-ink-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
                        {s.label}
                      </span>
                      <span className="tabular text-ink">{fmt(r[s.key])} h</span>
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
