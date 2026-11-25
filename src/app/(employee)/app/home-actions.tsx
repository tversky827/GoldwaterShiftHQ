"use client";

import { Repeat } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelSwapAction, markAllReadAction, respondSwapAction, type EmployeeResult } from "./marketplace-actions";

export interface SwapItem {
  id: string;
  incoming: boolean;
  status: string;
  title: string;
  detail: string;
  note: string | null;
}

export function SwapRequests({ items }: { items: SwapItem[] }) {
  const [msg, setMsg] = useState<EmployeeResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<EmployeeResult>) => start(async () => setMsg(await fn()));
  if (!items.length && !msg) return null;
  return (
    <section>
      <h2 className="mb-2 text-[20px] font-semibold tracking-tight">Shift swaps</h2>
      {msg && <div className={`mb-2 rounded-2xl px-4 py-3 text-[14px] ${msg.ok ? "bg-positive-soft text-positive" : "bg-critical-soft text-critical"}`}>{msg.message}</div>}
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="rounded-2xl border border-black/[0.04] bg-surface px-4 py-3 shadow-card">
            <div className="flex items-start gap-3">
              <Repeat className="mt-1 size-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{s.title}</div>
                <div className="text-[13px] text-muted">{s.detail}</div>
                {s.note && <div className="mt-1 text-[13px] italic text-ink-2">“{s.note}”</div>}
              </div>
            </div>
            {s.incoming && s.status === "pending_peer" ? (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="quiet" className="flex-1" disabled={pending} onClick={() => run(() => respondSwapAction(s.id, false))}>
                  Decline
                </Button>
                <Button size="sm" className="flex-1" disabled={pending} onClick={() => run(() => respondSwapAction(s.id, true))}>
                  Accept
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between text-[12px] text-faint">
                <span>{s.status === "pending_manager" ? "Waiting for manager approval" : "Waiting for your colleague"}</span>
                {!s.incoming && (
                  <Button size="sm" variant="quiet" disabled={pending} onClick={() => run(() => cancelSwapAction(s.id))}>
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <button className="text-[14px] font-medium text-accent disabled:opacity-50" disabled={pending} onClick={() => start(async () => void (await markAllReadAction()))}>
      Mark all read
    </button>
  );
}
