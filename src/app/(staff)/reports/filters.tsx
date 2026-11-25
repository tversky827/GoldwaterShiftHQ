"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const PRESETS = [
  { k: "this_week", l: "This week" },
  { k: "last_week", l: "Last week" },
  { k: "last_4_weeks", l: "Last 4 weeks" },
  { k: "last_3_months", l: "Last 3 months" },
  { k: "custom", l: "Custom" },
];

export function ReportFilters({ preset, from, to, facilityId, facilities }: { preset: string; from: string; to: string; facilityId: string; facilities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [custom, setCustom] = useState({ from, to });
  const go = (p: Record<string, string>) => {
    const q = new URLSearchParams({ preset, facilityId, ...p });
    if (q.get("preset") !== "custom") {
      q.delete("from");
      q.delete("to");
    }
    if (!q.get("facilityId")) q.delete("facilityId");
    router.push(`/reports?${q}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex flex-wrap rounded-full bg-fill p-1 text-[13px]" role="radiogroup" aria-label="Period">
        {PRESETS.map((p) => (
          <button key={p.k} role="radio" aria-checked={preset === p.k} onClick={() => (p.k === "custom" ? go({ preset: "custom", from: custom.from, to: custom.to }) : go({ preset: p.k }))} className={cn("rounded-full px-3 py-1", preset === p.k ? "bg-surface font-medium shadow-card" : "text-ink-2")}>
            {p.l}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From" className="h-9 w-auto" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span className="text-faint">–</span>
          <Input type="date" aria-label="To" className="h-9 w-auto" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          <Button size="sm" variant="secondary" onClick={() => go({ preset: "custom", from: custom.from, to: custom.to })}>
            Apply
          </Button>
        </div>
      )}
      {facilities.length > 1 && (
        <Select aria-label="Facility" className="h-9 w-auto min-w-52" value={facilityId} onChange={(e) => go({ facilityId: e.target.value })}>
          <option value="">All facilities</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

export function ExportMenu({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const csv = [
    { k: "summary", l: "Summary by facility" },
    { k: "coverage", l: "Shift coverage" },
    { k: "overtime", l: "Overtime" },
    { k: "open_shifts", l: "Open shifts" },
    { k: "callouts", l: "Callouts" },
  ];
  return (
    <div className="relative flex items-center gap-2">
      <Button asChild>
        <a href={`/api/reports/export?format=xlsx&${query}`}>
          <Download /> Export to Excel
        </a>
      </Button>
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        CSV
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-2xl border border-line bg-surface p-1.5 shadow-pop" onMouseLeave={() => setOpen(false)}>
          {csv.map((c) => (
            <a key={c.k} href={`/api/reports/export?format=csv&sheet=${c.k}&${query}`} className="block rounded-xl px-3 py-2 text-[14px] text-ink-2 hover:bg-fill" onClick={() => setOpen(false)}>
              {c.l}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
