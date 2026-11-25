"use client";

import { Check } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveMatrixAction } from "../../../budget-actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Section {
  shift: { id: string; code: string; name: string; startTime: string; endTime: string; paidHours: number };
  rows: { unitId: string | null; unitName: string | null; positionId: string; positionCode: string; positionName: string; days: number[] }[];
}

export function BudgetMatrix({ templateId, facilityId, sections, editable }: { templateId: string; facilityId: string; sections: Section[]; editable: boolean }) {
  const initial = useMemo(() => sections.map((s) => s.rows.map((r) => [...r.days])), [sections]);
  const [values, setValues] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const weekly = sections.reduce((t, s, si) => t + values[si].reduce((a, days) => a + days.reduce((x, y) => x + y, 0), 0) * s.shift.paidHours, 0);

  const set = (si: number, ri: number, d: number, v: number) =>
    setValues((cur) => cur.map((rows, i) => (i !== si ? rows : rows.map((days, j) => (j !== ri ? days : days.map((x, k) => (k === d ? Math.max(0, Math.min(99, v)) : x)))))));
  const fillRow = (si: number, ri: number, from: number) => setValues((cur) => cur.map((rows, i) => (i !== si ? rows : rows.map((days, j) => (j !== ri ? days : days.map(() => days[from]))))));

  const save = () =>
    start(async () => {
      const cells = sections.flatMap((s, si) => s.rows.flatMap((r, ri) => values[si][ri].map((requiredCount, dayOfWeek) => ({ unitId: r.unitId, positionId: r.positionId, shiftTemplateId: s.shift.id, dayOfWeek, requiredCount }))));
      const res = await saveMatrixAction(templateId, facilityId, cells);
      setMsg({ ok: res.ok, text: res.message });
    });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[14px]">
          <thead>
            <tr className="text-[12px] uppercase tracking-wide text-faint">
              <th className="px-6 py-2.5 text-left font-medium">Position</th>
              {DAYS.map((d) => (
                <th key={d} className="w-[72px] px-1 py-2.5 text-center font-medium">
                  {d}
                </th>
              ))}
              <th className="w-[90px] px-2 py-2.5 text-right font-medium">Per week</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s, si) => (
              <SectionRows key={s.shift.id} s={s}>
                {s.rows.map((r, ri) => {
                  const total = values[si][ri].reduce((a, b) => a + b, 0);
                  return (
                    <tr key={`${r.unitId}-${r.positionId}`} className="border-t border-line/70">
                      <td className="px-6 py-1.5">
                        <span className="font-medium">{r.positionCode}</span> <span className="text-muted">{r.unitName ?? r.positionName}</span>
                      </td>
                      {values[si][ri].map((v, d) => (
                        <td key={d} className="px-1 py-1.5 text-center">
                          {editable ? (
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={99}
                              value={v}
                              aria-label={`${r.positionCode} ${s.shift.name} ${DAYS[d]}`}
                              onChange={(e) => set(si, ri, d, Number(e.target.value || 0))}
                              onFocus={(e) => e.currentTarget.select()}
                              className={cn("tabular h-9 w-14 rounded-lg border text-center text-[15px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15", v === initial[si][ri][d] ? "border-line bg-surface" : "border-accent bg-accent-soft", v === 0 && "text-faint")}
                            />
                          ) : (
                            <span className="tabular">{v || "–"}</span>
                          )}
                        </td>
                      ))}
                      <td className="tabular px-2 py-1.5 text-right text-muted">
                        {total}
                        {editable && (
                          <button type="button" onClick={() => fillRow(si, ri, 1)} className="ml-2 text-[12px] text-accent hover:underline" title="Copy Monday's number to every day">
                            Fill
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </SectionRows>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
        <div className="tabular text-[14px] text-muted">
          <strong className="text-ink">{Math.round(weekly).toLocaleString()}</strong> budgeted hours / week
        </div>
        {msg && <div className={cn("text-[14px]", msg.ok ? "text-positive" : "text-critical")}>{msg.ok && <Check className="mr-1 inline size-4" />}{msg.text}</div>}
        {editable && (
          <div className="flex gap-2">
            {dirty && (
              <Button variant="quiet" onClick={() => setValues(initial)}>
                Discard
              </Button>
            )}
            <Button disabled={!dirty || pending} onClick={save}>
              {pending ? "Saving…" : "Save budget"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionRows({ s, children }: { s: Section; children: React.ReactNode }) {
  const t = (x: string) => {
    const [h, m] = x.split(":").map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
  };
  return (
    <>
      <tr className="bg-fill/60">
        <td colSpan={9} className="px-6 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
          {s.shift.name} <span className="font-normal normal-case tracking-normal text-faint">· {t(s.shift.startTime)} – {t(s.shift.endTime)} · {s.shift.paidHours} paid hours</span>
        </td>
      </tr>
      {children}
    </>
  );
}
