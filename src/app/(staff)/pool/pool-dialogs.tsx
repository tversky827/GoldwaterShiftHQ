"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { FormDialog } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/fields";
import { Badge, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { addToPoolAction, candidatesAction, placeAction, searchAddCandidatesAction, type Candidate } from "./actions";

const TONE: Record<string, "positive" | "neutral" | "caution" | "critical"> = { ok: "positive", warning: "neutral", approval_required: "caution", hard_block: "critical" };
const LABEL: Record<string, string> = { ok: "Good fit", warning: "OK, with a note", approval_required: "Needs approval", hard_block: "Not allowed" };

export function FindStaffDialog({ shiftId, title, subtitle, canPlace }: { shiftId: string; title: string; subtitle: string; canPlace: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setList(null);
    setError(null);
    setResult(null);
    setPicked(null);
    start(async () => {
      const r = await candidatesAction(shiftId);
      if (r.ok) setList(r.candidates ?? []);
      else setError(r.message ?? "Couldn't load pool staff.");
    });
  }, [open, shiftId]);

  const chosen = list?.find((c) => c.employeeId === picked);
  const needsWhy = !!chosen && (chosen.needsApproval || chosen.needsOverride);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm" variant="outline">
          Find pool staff
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface p-6 shadow-pop focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-7">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[20px] font-semibold tracking-tight">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-[14px] text-muted">{subtitle}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="quiet" size="icon" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          {result && <div role="status" className={cn("mb-4 rounded-xl px-4 py-3 text-[14px]", result.ok ? "bg-positive-soft text-positive" : "bg-critical-soft text-critical")}>{result.message}</div>}
          {error && <div className="rounded-xl bg-critical-soft px-4 py-3 text-[14px] text-critical">{error}</div>}
          {!list && !error && <p className="py-8 text-center text-[14px] text-muted">Checking every pool member against the rules…</p>}
          {list && list.length === 0 && <p className="py-8 text-center text-[14px] text-muted">No pool staff are qualified and authorized for this shift.</p>}
          {list && list.length > 0 && !result?.ok && (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {list.map((c) => (
                <li key={c.employeeId}>
                  <label className={cn("flex items-start gap-3 px-4 py-3", c.blocked ? "opacity-60" : "cursor-pointer", picked === c.employeeId && "bg-accent-soft/60")}>
                    <input type="radio" name="candidate" className="mt-1 size-[18px] accent-[var(--color-accent)]" disabled={c.blocked || !canPlace} checked={picked === c.employeeId} onChange={() => setPicked(c.employeeId)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium">{c.name}</span>
                        <Badge tone={TONE[c.outcome]}>{LABEL[c.outcome]}</Badge>
                      </span>
                      <span className="block text-[12px] text-muted">{c.hoursAfter} hours this week if placed</span>
                      {c.messages.length > 0 && (
                        <span className="mt-1 block space-y-0.5 text-[12px] text-ink-2">
                          {c.messages.map((m) => (
                            <span key={m.message} className="block">
                              {m.message}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {canPlace && list && list.length > 0 && !result?.ok && (
            <div className="mt-4 space-y-3">
              {needsWhy && <Textarea aria-label="Explanation" placeholder="Explanation for the exception (required), e.g. Approved overtime for survey week" value={why} onChange={(e) => setWhy(e.target.value)} />}
              <div className="flex justify-end">
                <Button
                  disabled={!picked || pending}
                  onClick={() =>
                    start(async () => {
                      const r = await placeAction(shiftId, picked!, why);
                      setResult({ ok: r.ok, message: r.message });
                    })
                  }
                >
                  {pending ? "Placing…" : chosen?.needsApproval || chosen?.needsOverride ? "Place (with exception)" : "Place"}
                </Button>
              </div>
            </div>
          )}
          {result?.ok && (
            <div className="mt-2 flex justify-end">
              <Dialog.Close asChild>
                <Button>
                  <Check /> Done
                </Button>
              </Dialog.Close>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AddToPoolDialog({ facilities }: { facilities: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; label: string; detail: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => start(async () => setResults(await searchAddCandidatesAction(q))), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <FormDialog
      title="Add to regional pool"
      description="Pool staff can pick up and be placed into shifts at every facility they're authorized for. Their hours are tracked across all facilities. No duplicate record is created."
      action={addToPoolAction}
      submitLabel="Add to pool"
      trigger={<Button>Add to pool</Button>}
    >
      <input type="hidden" name="employeeId" value={picked?.id ?? ""} />
      {picked ? (
        <div className="flex items-center justify-between rounded-xl bg-fill px-4 py-3 text-[15px]">
          <span className="font-medium">{picked.label}</span>
          <Button type="button" size="sm" variant="quiet" onClick={() => setPicked(null)}>
            Change
          </Button>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input aria-label="Find an employee" placeholder="Search by name or employee number" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-line">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className="block w-full px-4 py-2 text-left hover:bg-fill" onClick={() => setPicked(r)}>
                  <span className="block text-[14px] font-medium">{r.label}</span>
                  <span className="block text-[12px] text-muted">{r.detail}</span>
                </button>
              </li>
            ))}
            {!results.length && <li className="px-4 py-4 text-center text-[13px] text-muted">No matching active employees outside the pool.</li>}
          </ul>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-ink-2">Authorized to work at</div>
        <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
          {facilities.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] hover:bg-fill">
              <input type="checkbox" name="facilityId" value={f.id} className="size-4 accent-[var(--color-accent)]" />
              {f.name}
            </label>
          ))}
        </div>
      </div>
      <TextAreaField label="Reason" name="reason" required minLength={3} placeholder="e.g. Cross-trained float CNA, approved by regional director" />
    </FormDialog>
  );
}
