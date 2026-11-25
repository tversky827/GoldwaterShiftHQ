"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, CalendarRange, Check, ChevronLeft, ChevronRight, Copy, GripVertical, Minus, Plus, Repeat, Search, Send, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  addShiftAction,
  adjustOpeningsAction,
  assignAction,
  copyWeekAction,
  decideApprovalAction,
  generateWeekAction,
  publishAction,
  repeatWeekAction,
  unassignAction,
  type BoardResult,
} from "./actions";

interface CellAssignment { assignmentId: string; employeeId: string; name: string; outcome: string; warnings: string[] }
interface Cell { shiftId: string; required: number; assigned: CellAssignment[]; source: string; notes: string | null }
interface Row { key: string; shiftCode: string; shiftName: string; start: string; end: string; positionId: string; positionCode: string; positionName: string; unitName: string | null; cells: (Cell[] | null)[] }
interface RosterEntry {
  id: string; name: string; employmentType: string; status: string; isPool: boolean; isHome: boolean;
  positions: { id: string; code: string }[]; credentialIssue: boolean;
  hours: { scheduled: number; actual: number; projected: number; otherFacilities: number };
  overtimeRisk: "over" | "near" | null; unavailableDays: number[]; maxWeeklyHours: string | null;
}
interface Approval { id: string; employee: string; startsAt: string; position: string; requestedBy: string; reasons: string[] }

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE = { full_time: "FT", part_time: "PT", prn: "PRN", temporary: "Temp", unknown: "" } as Record<string, string>;

function fmtTime(t: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const hh = h % 12 || 12;
  return `${hh}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}
function dayLabel(d: string) {
  const dt = new Date(`${d}T12:00:00Z`);
  return { dow: DOW[dt.getUTCDay()], num: dt.getUTCDate(), month: dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) };
}

export function ScheduleBoard(props: {
  facilities: { id: string; name: string }[];
  facility: { id: string; name: string; timezone: string };
  week: string;
  prevWeek: string;
  nextWeek: string;
  filters: { dept: string; pos: string };
  departments: { id: string; name: string }[];
  positions: { id: string; code: string; name: string }[];
  templates: { id: string; name: string; code: string }[];
  schedule: { id: string; status: string; publishedAt: string | null } | null;
  days: string[];
  rows: Row[];
  totals: { required: number; filled: number; open: number };
  roster: RosterEntry[];
  approvals: Approval[];
  permissions: { manage: boolean; publish: boolean; approve: boolean };
  rulesConfirmed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<{ shiftId: string; employeeId: string; result: BoardResult } | null>(null);
  const [q, setQ] = useState("");
  const [posFilter, setPosFilter] = useState<string>("");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: props.facility.timezone });

  const run = (fn: () => Promise<BoardResult>, onResult?: (r: BoardResult) => void) =>
    start(async () => {
      const r = await fn();
      if (onResult) onResult(r);
      else setToast({ ok: r.ok, text: r.message });
      router.refresh();
    });

  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ facilityId: props.facility.id, week: props.week, ...(props.filters.dept ? { dept: props.filters.dept } : {}), ...(props.filters.pos ? { pos: props.filters.pos } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    router.push(`/schedule?${p}`);
  };

  const assign = (shiftId: string, employeeId: string, explanation?: string) =>
    run(
      () => assignAction(shiftId, employeeId, explanation),
      (r) => {
        if (r.status === "needs_override" || r.status === "needs_approval_reason" || r.status === "blocked") setReview({ shiftId, employeeId, result: r });
        else {
          setReview(null);
          setToast({ ok: r.ok, text: r.message });
        }
      },
    );

  const rosterById = useMemo(() => new Map(props.roster.map((r) => [r.id, r])), [props.roster]);
  const visibleRoster = props.roster.filter((r) => (!q || r.name.toLowerCase().includes(q.toLowerCase())) && (!posFilter || r.positions.some((p) => p.id === posFilter)));
  const sel = selected ? rosterById.get(selected) : null;

  // Group rows by shift for section headers.
  const groups: { shiftCode: string; shiftName: string; start: string; end: string; rows: Row[] }[] = [];
  for (const r of props.rows) {
    const g = groups.find((x) => x.shiftCode === r.shiftCode);
    if (g) g.rows.push(r);
    else groups.push({ shiftCode: r.shiftCode, shiftName: r.shiftName, start: r.start, end: r.end, rows: [r] });
  }
  const pct = props.totals.required ? Math.round((props.totals.filled / props.totals.required) * 100) : 0;
  const weekLabel = `${dayLabel(props.days[0]).month} ${dayLabel(props.days[0]).num} – ${dayLabel(props.days[6]).month} ${dayLabel(props.days[6]).num}`;

  return (
    <div className="-mx-2">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Select value={props.facility.id} onChange={(e) => nav({ facilityId: e.target.value })} className="mb-2 h-9 w-auto min-w-[260px] border-transparent bg-transparent pl-0 text-[13px] font-medium text-muted hover:text-ink" aria-label="Facility">
            {props.facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">{weekLabel}</h1>
            <div className="flex items-center">
              <Button variant="quiet" size="icon" aria-label="Previous week" onClick={() => nav({ week: props.prevWeek })}>
                <ChevronLeft />
              </Button>
              <Button variant="quiet" size="icon" aria-label="Next week" onClick={() => nav({ week: props.nextWeek })}>
                <ChevronRight />
              </Button>
              <Button variant="quiet" size="sm" onClick={() => nav({ week: "" })}>
                This week
              </Button>
            </div>
          </div>
          {props.schedule && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-muted">
              <Badge tone={props.schedule.status === "published" ? "positive" : "neutral"}>{props.schedule.status === "published" ? "Published" : "Draft"}</Badge>
              <span className="tabular">
                {props.totals.filled}/{props.totals.required} filled · {props.totals.open} open · {pct}% covered
              </span>
            </div>
          )}
        </div>
        {props.schedule && props.permissions.manage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => copyWeekAction(props.facility.id, props.prevWeek, props.week))}>
              <Copy /> Copy last week
            </Button>
            <RepeatButton disabled={pending} onRepeat={(n) => run(() => repeatWeekAction(props.facility.id, props.week, n))} />
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => generateWeekAction(props.facility.id, props.week))} title="Pick up budget changes">
              <CalendarRange /> Sync with budget
            </Button>
            {props.permissions.publish && (
              <Button size="md" disabled={pending} onClick={() => run(() => publishAction(props.schedule!.id))}>
                <Send /> {props.schedule.status === "published" ? "Republish" : "Publish"}
              </Button>
            )}
          </div>
        )}
      </div>

      {!props.rulesConfirmed && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-caution-soft px-4 py-3 text-[13px] text-caution">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Scheduling and overtime rules use example values that haven't been confirmed yet. A corporate administrator can review and confirm them in Settings → Rules.</span>
        </div>
      )}

      {props.approvals.length > 0 && <Approvals approvals={props.approvals} canApprove={props.permissions.approve} timezone={props.facility.timezone} onDecide={(id, ok, reason) => run(() => decideApprovalAction(id, ok, reason))} pending={pending} />}

      {!props.schedule ? (
        <div className="rounded-3xl border border-black/[0.04] bg-surface px-6 py-16 text-center shadow-card">
          <CalendarRange className="mx-auto size-10 text-faint" />
          <h2 className="mt-4 text-[20px] font-semibold tracking-tight">No schedule for this week yet</h2>
          <p className="mx-auto mt-1 max-w-md text-[14px] text-muted">Creating the week turns the facility's staffing budget into open shifts. Nobody is assigned until you place them.</p>
          {props.permissions.manage && (
            <div className="mt-6 flex justify-center gap-2">
              <Button size="lg" disabled={pending} onClick={() => run(() => generateWeekAction(props.facility.id, props.week))}>
                {pending ? "Creating…" : "Create this week's schedule"}
              </Button>
              <Button size="lg" variant="secondary" disabled={pending} onClick={() => run(() => generateWeekAction(props.facility.id, props.week, 4))}>
                Create 4 weeks
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row">
          {/* Grid */}
          <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-black/[0.04] bg-surface shadow-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <Select value={props.filters.dept} onChange={(e) => nav({ dept: e.target.value })} className="h-9 w-auto" aria-label="Department">
                <option value="">All departments</option>
                {props.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <Select value={props.filters.pos} onChange={(e) => nav({ pos: e.target.value })} className="h-9 w-auto" aria-label="Position">
                <option value="">All positions</option>
                {props.positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {sel && (
                <div className="ml-auto flex items-center gap-2 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-[13px] text-accent">
                  Placing <strong>{sel.name}</strong>: tap an opening
                  <button className="rounded-full p-1 hover:bg-white/60" onClick={() => setSelected(null)} aria-label="Cancel">
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] table-fixed border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 w-[104px] bg-surface px-3 py-3 text-left text-[12px] font-medium text-faint" />
                    {props.days.map((d) => {
                      const l = dayLabel(d);
                      return (
                        <th key={d} className={cn("px-1.5 py-3 text-center font-medium", d === today ? "text-accent" : "text-ink-2")}>
                          <div className="text-[12px] uppercase tracking-wide">{l.dow}</div>
                          <div className={cn("mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-[15px]", d === today && "bg-accent text-white")}>{l.num}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-muted">
                        No shifts match these filters. If the budget is empty, add requirements in Facilities → Staffing budget.
                      </td>
                    </tr>
                  )}
                  {groups.map((g) => (
                    <GroupRows key={g.shiftCode} g={g} days={props.days} today={today}>
                      {g.rows.map((r) => (
                        <tr key={r.key} className="border-t border-line/70">
                          <td className="sticky left-0 z-10 bg-surface px-3 py-2 align-top">
                            <div className="font-semibold">{r.positionCode}</div>
                            <div className="truncate text-[12px] text-muted">{r.unitName ?? r.positionName}</div>
                          </td>
                          {r.cells.map((cell, i) => (
                            <td key={i} className="px-1 py-1.5 align-top">
                              {(cell ?? []).map((c) => {
                                const open = c.required - c.assigned.length;
                                const isOver = dragOver === c.shiftId;
                                const placing = sel ?? (dragging ? rosterById.get(dragging) ?? null : null);
                                const qualified = !placing || placing.positions.some((p) => p.id === r.positionId);
                                const selectable = !!sel && open > 0 && qualified && props.permissions.manage;
                                return (
                                  <div
                                    key={c.shiftId}
                                    onDragOver={(e) => {
                                      if (!props.permissions.manage || open <= 0) return;
                                      e.preventDefault();
                                      setDragOver(c.shiftId);
                                    }}
                                    onDragLeave={() => setDragOver((x) => (x === c.shiftId ? null : x))}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      setDragOver(null);
                                      const id = e.dataTransfer.getData("text/employee-id");
                                      if (id) assign(c.shiftId, id);
                                    }}
                                    className={cn("group/cell rounded-xl border p-1.5 transition-all", isOver ? "border-accent bg-accent-soft" : open > 0 ? "border-line bg-surface" : "border-transparent bg-fill/70", selectable && "cursor-pointer hover:border-accent", placing && !qualified && "opacity-35")}
                                    onClick={() => selectable && assign(c.shiftId, sel!.id)}
                                  >
                                    <div className="mb-1 flex items-center justify-between px-0.5">
                                      <span className={cn("tabular rounded-md px-1.5 py-px text-[12px] font-semibold", open <= 0 ? "bg-positive-soft text-positive" : c.assigned.length === 0 ? "bg-critical-soft text-critical" : "bg-caution-soft text-caution")} title={`${c.assigned.length} of ${c.required} filled`}>
                                        {c.assigned.length}/{c.required}
                                      </span>
                                      {props.permissions.manage && (
                                        <span className="flex opacity-0 transition-opacity group-hover/cell:opacity-100">
                                          <button className="rounded p-0.5 text-faint hover:bg-fill hover:text-ink" aria-label="Remove an opening" onClick={(e) => (e.stopPropagation(), run(() => adjustOpeningsAction(c.shiftId, -1)))}>
                                            <Minus className="size-3" />
                                          </button>
                                          <button className="rounded p-0.5 text-faint hover:bg-fill hover:text-ink" aria-label="Add an opening" onClick={(e) => (e.stopPropagation(), run(() => adjustOpeningsAction(c.shiftId, 1)))}>
                                            <Plus className="size-3" />
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                    <div className="space-y-1">
                                      {c.assigned.map((a) => (
                                        <div key={a.assignmentId} className={cn("group/chip flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px]", a.outcome === "warning" ? "bg-caution-soft" : a.outcome === "approval_required" || a.outcome === "hard_block" ? "bg-[#f3ecff]" : "bg-fill")} title={a.warnings.join("\n") || undefined}>
                                          {a.outcome !== "ok" && <ShieldAlert className="size-3 shrink-0 text-caution" />}
                                          <span className="min-w-0 flex-1 truncate">{a.name}</span>
                                          {props.permissions.manage && (
                                            <button className="shrink-0 rounded text-faint opacity-0 hover:text-critical group-hover/chip:opacity-100" aria-label={`Remove ${a.name}`} onClick={(e) => (e.stopPropagation(), run(() => unassignAction(a.assignmentId)))}>
                                              <X className="size-3" />
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                      {open > 0 &&
                                        Array.from({ length: Math.min(open, 3) }).map((_, k) => (
                                          <div key={k} className={cn("rounded-lg border border-dashed px-1.5 py-1 text-[12px]", selectable ? "border-accent/50 text-accent" : "border-line-strong text-faint")}>
                                            {k === 2 && open > 3 ? `+${open - 2} open` : "Open"}
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </GroupRows>
                  ))}
                </tbody>
              </table>
            </div>
            {props.permissions.manage && <AddShiftBar templates={props.templates} positions={props.positions} days={props.days} onAdd={(t, p, d, n) => run(() => addShiftAction(props.schedule!.id, t, p, d, n))} />}
          </div>

          {/* Staff panel */}
          {props.permissions.manage && (
            <aside className="w-full shrink-0 rounded-2xl border border-black/[0.04] bg-surface shadow-card xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:w-[300px] xl:overflow-hidden">
              <div className="border-b border-line p-4">
                <div className="mb-2 text-[15px] font-semibold">Staff</div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff" className="h-9 pl-9 text-[14px]" />
                </div>
                <Select value={posFilter} onChange={(e) => setPosFilter(e.target.value)} className="mt-2 h-9 text-[14px]" aria-label="Filter staff by position">
                  <option value="">All positions</option>
                  {props.positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <p className="mt-2 text-[12px] text-faint">Drag onto an opening, or tap a name, then an opening. Hours are this week across all facilities.</p>
              </div>
              <ul className="max-h-[520px] divide-y divide-line/70 overflow-y-auto xl:max-h-[calc(100dvh-16rem)]">
                {visibleRoster.map((e) => (
                  <li key={e.id}>
                    <button
                      draggable
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData("text/employee-id", e.id);
                        ev.dataTransfer.effectAllowed = "copy";
                        setDragging(e.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setSelected((s) => (s === e.id ? null : e.id))}
                      className={cn("flex w-full cursor-grab items-center gap-2 px-3 py-2.5 text-left transition-colors active:cursor-grabbing", selected === e.id ? "bg-accent-soft" : "hover:bg-fill/70")}
                      aria-pressed={selected === e.id}
                    >
                      <GripVertical className="size-3.5 shrink-0 text-line-strong" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[14px] font-medium">{e.name}</span>
                          {e.credentialIssue && <span title="Credential needs attention"><ShieldAlert className="size-3.5 shrink-0 text-caution" /></span>}
                        </span>
                        <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                          {e.positions.map((p) => p.code).join(" · ") || "No classification"}
                          {TYPE[e.employmentType] && <span>· {TYPE[e.employmentType]}</span>}
                          {e.isPool && <span className="text-accent">· Pool</span>}
                          {!e.isHome && !e.isPool && <span className="text-accent">· Cross-facility</span>}
                          {e.status === "leave" && <span className="text-caution">· On leave</span>}
                          {e.unavailableDays.length > 0 && <span>· Off {e.unavailableDays.map((d) => DOW[d]).join("/")}</span>}
                        </span>
                      </span>
                      <span className={cn("tabular shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-semibold", e.overtimeRisk === "over" ? "bg-critical-soft text-critical" : e.overtimeRisk === "near" ? "bg-caution-soft text-caution" : "text-ink-2")} title={`Projected ${e.hours.projected}h · scheduled ${e.hours.scheduled}h · actual ${e.hours.actual}h${e.hours.otherFacilities ? ` · ${e.hours.otherFacilities}h at other facilities` : ""}`}>
                        {Math.round(e.hours.projected * 10) / 10}h
                      </span>
                    </button>
                  </li>
                ))}
                {visibleRoster.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">No matching staff.</li>}
              </ul>
            </aside>
          )}
        </div>
      )}

      {review && (
        <RuleReview
          result={review.result}
          employee={rosterById.get(review.employeeId)?.name ?? "This employee"}
          pending={pending}
          onClose={() => setReview(null)}
          onConfirm={(explanation) => assign(review.shiftId, review.employeeId, explanation)}
        />
      )}

      {toast && (
        <div role="status" className={cn("fixed bottom-6 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-start gap-3 rounded-2xl px-5 py-3.5 text-[14px] text-white shadow-pop", toast.ok ? "bg-ink" : "bg-critical")}>
          {toast.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
          <span className="max-w-xl">{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function GroupRows({ g, days, children }: { g: { shiftCode: string; shiftName: string; start: string; end: string }; days: string[]; today: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-fill/60">
        <td colSpan={days.length + 1} className="px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
          {g.shiftName} <span className="font-normal normal-case tracking-normal text-faint">· {fmtTime(g.start)}–{fmtTime(g.end)}</span>
        </td>
      </tr>
      {children}
    </>
  );
}

function RepeatButton({ onRepeat, disabled }: { onRepeat: (n: number) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(2);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Repeat /> Repeat
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-surface p-6 shadow-pop">
          <Dialog.Title className="text-[20px] font-semibold tracking-tight">Repeat this week</Dialog.Title>
          <Dialog.Description className="mt-1 text-[14px] text-muted">Copies this week's assignments forward. Each one is re-checked against the rules; anything not allowed is left open.</Dialog.Description>
          <label className="mt-5 block text-[13px] font-medium text-ink-2">
            Number of weeks
            <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="mt-1.5">
              {[1, 2, 3, 4, 6, 8].map((x) => (
                <option key={x} value={x}>
                  {x} week{x > 1 ? "s" : ""}
                </option>
              ))}
            </Select>
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                onRepeat(n);
              }}
            >
              Repeat
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RuleReview({ result, employee, pending, onClose, onConfirm }: { result: BoardResult; employee: string; pending: boolean; onClose: () => void; onConfirm: (explanation: string) => void }) {
  const [text, setText] = useState("");
  const blocked = result.status === "blocked";
  const canProceed = result.status === "needs_approval_reason" || (result.status === "needs_override" && !result.message.includes("Only someone"));
  const tone = { warning: "caution", approval_required: "accent", hard_block: "critical" } as const;
  const label = { warning: "Warning", approval_required: "Needs approval", hard_block: "Blocked" } as Record<string, string>;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-surface p-6 shadow-pop sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-7">
          <Dialog.Title className="text-[20px] font-semibold tracking-tight">{blocked ? `${employee} can't take this shift` : canProceed ? `Review before assigning ${employee}` : `${employee} needs an override`}</Dialog.Title>
          <Dialog.Description className="mt-1 text-[14px] text-muted">
            {result.hours && (
              <>
                Projected this week across all facilities: <strong className="tabular text-ink">{Math.round(result.hours.projected * 10) / 10}h → {Math.round(result.hours.after * 10) / 10}h</strong>
                {result.hours.threshold ? ` (overtime after ${result.hours.threshold}h)` : ""}.
              </>
            )}
          </Dialog.Description>
          <ul className="mt-5 space-y-2">
            {(result.results ?? []).map((r, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl bg-fill/70 px-3.5 py-3">
                <Badge tone={tone[r.outcome as keyof typeof tone] ?? "neutral"} className="mt-0.5 shrink-0">
                  {label[r.outcome] ?? r.outcome}
                </Badge>
                <div className="text-[14px]">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-muted">{r.message}</div>
                </div>
              </li>
            ))}
          </ul>
          {canProceed && (
            <label className="mt-5 block text-[13px] font-medium text-ink-2">
              Explanation (required, saved to the audit log)
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="mt-1.5" placeholder="e.g. Census spike; DON approved extra hours" autoFocus />
            </label>
          )}
          {!canProceed && !blocked && <p className="mt-4 text-[14px] text-muted">{result.message}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="quiet" onClick={onClose}>
              {canProceed ? "Cancel" : "Close"}
            </Button>
            {canProceed && (
              <Button disabled={pending || text.trim().length < 5} onClick={() => onConfirm(text)}>
                {result.status === "needs_approval_reason" ? "Approve and assign" : "Override and assign"}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Approvals({ approvals, canApprove, timezone, onDecide, pending }: { approvals: Approval[]; canApprove: boolean; timezone: string; onDecide: (id: string, ok: boolean, reason: string) => void; pending: boolean }) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <div className="mb-5 rounded-2xl border border-black/[0.04] bg-surface p-4 shadow-card">
      <div className="mb-3 text-[15px] font-semibold">
        Waiting for approval <span className="tabular text-muted">({approvals.length})</span>
      </div>
      <ul className="space-y-3">
        {approvals.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 rounded-xl bg-fill/60 p-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1 text-[14px]">
              <span className="font-medium">{a.employee}</span> · {a.position} · {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(a.startsAt))}
              <div className="text-[12px] text-muted">
                {a.reasons.join(" ")} {a.requestedBy && `Requested by ${a.requestedBy}.`}
              </div>
            </div>
            {canApprove ? (
              <div className="flex gap-2">
                <Input value={reasons[a.id] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))} placeholder="Reason" className="h-9 w-48 text-[14px]" />
                <Button size="sm" variant="outline" disabled={pending || (reasons[a.id] ?? "").trim().length < 5} onClick={() => onDecide(a.id, false, reasons[a.id])}>
                  Decline
                </Button>
                <Button size="sm" disabled={pending || (reasons[a.id] ?? "").trim().length < 5} onClick={() => onDecide(a.id, true, reasons[a.id])}>
                  Approve
                </Button>
              </div>
            ) : (
              <Badge tone="caution">Pending</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddShiftBar({ templates, positions, days, onAdd }: { templates: { id: string; name: string }[]; positions: { id: string; code: string; name: string }[]; days: string[]; onAdd: (t: string, p: string, d: string, n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(templates[0]?.id ?? "");
  const [p, setP] = useState(positions[0]?.id ?? "");
  const [d, setD] = useState(days[0]);
  const [n, setN] = useState(1);
  if (!open)
    return (
      <div className="border-t border-line px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add a shift outside the budget
        </Button>
      </div>
    );
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3 text-[13px]">
      <Select value={d} onChange={(e) => setD(e.target.value)} className="h-9 w-auto" aria-label="Day">
        {days.map((x) => (
          <option key={x} value={x}>
            {dayLabel(x).dow} {dayLabel(x).num}
          </option>
        ))}
      </Select>
      <Select value={t} onChange={(e) => setT(e.target.value)} className="h-9 w-auto" aria-label="Shift">
        {templates.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Select value={p} onChange={(e) => setP(e.target.value)} className="h-9 w-auto" aria-label="Position">
        {positions.map((x) => (
          <option key={x.id} value={x.id}>
            {x.code}
          </option>
        ))}
      </Select>
      <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="h-9 w-auto" aria-label="Openings">
        {[1, 2, 3, 4, 5].map((x) => (
          <option key={x} value={x}>
            {x} opening{x > 1 ? "s" : ""}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        onClick={() => {
          onAdd(t, p, d, n);
          setOpen(false);
        }}
      >
        Add shift
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
