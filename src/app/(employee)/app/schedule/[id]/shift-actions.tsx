"use client";

import { AlertTriangle, CheckCircle2, PhoneOff, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { calloutAction, requestSwapAction, type EmployeeResult } from "../../marketplace-actions";

export interface SwapOption {
  id: string;
  day: string;
  range: string;
  name: string;
}

function Result({ r }: { r: EmployeeResult }) {
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-2xl px-4 py-3 text-[14px]", r.ok ? "bg-positive-soft text-positive" : "bg-critical-soft text-critical")}>
      {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      {r.message}
    </div>
  );
}

export function ShiftActions({ assignmentId, options, swapPending, startsSoon }: { assignmentId: string; options: SwapOption[]; swapPending: boolean; startsSoon: boolean }) {
  const [mode, setMode] = useState<"none" | "swap" | "callout">("none");
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<EmployeeResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<EmployeeResult>, after?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok && after) {
        router.replace(after);
        return;
      }
      setResult(r);
      if (r.ok) setMode("none");
    });

  return (
    <div className="space-y-4">
      {result && <Result r={result} />}
      {mode === "none" && (
        <div className="grid gap-3">
          <Button size="lg" variant="secondary" disabled={swapPending || !options.length} onClick={() => setMode("swap")}>
            <Repeat /> {swapPending ? "Swap requested" : "Swap with a colleague"}
          </Button>
          {!options.length && !swapPending && <p className="-mt-1 text-center text-[12px] text-faint">No colleague shifts to swap with in the next two weeks.</p>}
          <Button size="lg" variant="destructive" onClick={() => setMode("callout")}>
            <PhoneOff /> I can’t make it
          </Button>
        </div>
      )}

      {mode === "swap" && (
        <div className="space-y-4">
          <h2 className="text-[20px] font-semibold tracking-tight">Choose a shift to trade for</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {options.map((o) => (
              <li key={o.id}>
                <label className={cn("flex cursor-pointer items-center gap-3 px-4 py-3", pick === o.id && "bg-accent-soft/60")}>
                  <input type="radio" name="swap" className="size-[18px] accent-[var(--color-accent)]" checked={pick === o.id} onChange={() => setPick(o.id)} />
                  <span className="flex-1">
                    <span className="block text-[15px] font-medium">{o.day}</span>
                    <span className="tabular block text-[13px] text-muted">{o.range}</span>
                  </span>
                  <span className="text-[13px] text-ink-2">{o.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <Textarea aria-label="Note to your colleague" placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <p className="text-[12px] text-faint">Your colleague accepts first, then a manager approves. Nothing changes until it’s approved.</p>
          <div className="flex gap-3">
            <Button variant="quiet" className="flex-1" onClick={() => setMode("none")}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!pick || pending} onClick={() => run(() => requestSwapAction(assignmentId, pick, note))}>
              {pending ? "Sending…" : "Request swap"}
            </Button>
          </div>
        </div>
      )}

      {mode === "callout" && (
        <div className="space-y-4">
          <h2 className="text-[20px] font-semibold tracking-tight">Let your manager know</h2>
          <p className="text-[14px] text-muted">{startsSoon ? "This shift starts soon. Please also call your supervisor directly." : "We’ll notify your manager and post the shift so a colleague can pick it up."}</p>
          <Textarea aria-label="Reason" placeholder="What happened? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          <div className="flex gap-3">
            <Button variant="quiet" className="flex-1" onClick={() => setMode("none")}>
              Keep my shift
            </Button>
            <Button variant="destructive" className="flex-1" disabled={pending} onClick={() => run(() => calloutAction(assignmentId, reason), "/app/schedule?notice=callout")}>
              {pending ? "Sending…" : "Confirm callout"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
