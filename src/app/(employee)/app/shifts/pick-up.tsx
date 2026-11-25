"use client";

import { AlertTriangle, CheckCircle2, Clock, Gift, Hourglass, MapPin, Zap } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cancelRequestAction, joinWaitlistAction, leaveWaitlistAction, pickUpAction, type EmployeeResult } from "../marketplace-actions";

export interface Card {
  listingId: string;
  day: string;
  range: string;
  tz: string;
  facilityName: string;
  positionName: string;
  paidHours: number;
  incentiveText: string | null;
  isCallout: boolean;
  open: number;
  mode: "instant" | "review";
  reasons: string[];
  warnings: string[];
  hoursAfter: number;
}
export interface Requested {
  id: string;
  day: string;
  range: string;
  facilityName: string;
  positionName: string;
}
export interface Full {
  listingId: string;
  shiftId: string;
  day: string;
  range: string;
  facilityName: string;
  positionName: string;
  onWaitlist: string | null;
}

function Banner({ r, onClose }: { r: EmployeeResult; onClose: () => void }) {
  const tone = !r.ok ? "bg-critical-soft text-critical" : r.status === "full" ? "bg-caution-soft text-caution" : "bg-positive-soft text-positive";
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 text-[14px]", tone)}>
      {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <span className="flex-1">{r.message}</span>
      <button onClick={onClose} className="text-[13px] font-medium opacity-80">
        OK
      </button>
    </div>
  );
}

export function PickUpList({ cards, requested, full }: { cards: Card[]; requested: Requested[]; full: Full[] }) {
  const [result, setResult] = useState<EmployeeResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const act = (key: string, fn: () => Promise<EmployeeResult>) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setResult(r);
      setBusy(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  return (
    <div className="space-y-8">
      {result && <Banner r={result} onClose={() => setResult(null)} />}

      {cards.length === 0 ? (
        <div className="rounded-3xl bg-fill px-6 py-10 text-center">
          <div className="text-[17px] font-semibold">No open shifts right now</div>
          <p className="mx-auto mt-1 max-w-xs text-[14px] text-muted">When a shift you’re qualified for opens up, it appears here and you’ll get a notification.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.listingId} className="rounded-3xl border border-black/[0.04] bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {c.isCallout && (
                    <div className="mb-1 inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-critical">
                      <Zap className="size-3.5" /> Needed soon
                    </div>
                  )}
                  <div className="text-[19px] font-semibold tracking-tight">{c.day}</div>
                  <div className="tabular text-[15px] text-ink-2">
                    {c.range} <span className="text-[12px] text-faint">{c.tz}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[14px] text-muted">
                    <MapPin className="size-4" /> {c.facilityName} · {c.positionName}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[12px] text-faint">
                  {c.paidHours} h
                  {c.open > 1 && <div>{c.open} spots</div>}
                </div>
              </div>
              {c.incentiveText && (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[13px] font-medium text-accent">
                  <Gift className="size-3.5" /> {c.incentiveText}
                </div>
              )}
              {(c.mode === "review" || c.warnings.length > 0) && (
                <div className="mt-3 space-y-1 text-[13px]">
                  {c.mode === "review" && (
                    <p className="flex items-start gap-1.5 text-caution">
                      <Hourglass className="mt-0.5 size-3.5 shrink-0" /> Needs a manager’s OK: {c.reasons.join(" ")}
                    </p>
                  )}
                  {c.warnings.map((w) => (
                    <p key={w} className="flex items-start gap-1.5 text-muted">
                      <Clock className="mt-0.5 size-3.5 shrink-0" /> {w}
                    </p>
                  ))}
                </div>
              )}
              <Button className="mt-4 w-full" size="lg" disabled={!!busy} aria-busy={busy === c.listingId} onClick={() => act(c.listingId, () => pickUpAction(c.listingId))}>
                {busy === c.listingId ? "One moment…" : c.mode === "review" ? "Request this shift" : "Pick up"}
              </Button>
              <p className="mt-2 text-center text-[12px] text-faint">You’d have {c.hoursAfter} hours this week</p>
            </li>
          ))}
        </ul>
      )}

      {requested.length > 0 && (
        <section>
          <h2 className="mb-2 text-[20px] font-semibold tracking-tight">Waiting for approval</h2>
          <ul className="divide-y divide-line">
            {requested.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{r.day}</div>
                  <div className="truncate text-[13px] text-muted">
                    {r.range} · {r.facilityName}
                  </div>
                </div>
                <Button size="sm" variant="quiet" disabled={!!busy} onClick={() => act(r.id, () => cancelRequestAction(r.id))}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {full.length > 0 && (
        <section>
          <h2 className="text-[20px] font-semibold tracking-tight">Just filled</h2>
          <p className="mb-2 text-[13px] text-muted">Join a waitlist and we’ll tell you the moment a spot opens.</p>
          <ul className="divide-y divide-line">
            {full.map((f) => (
              <li key={f.listingId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{f.day}</div>
                  <div className="truncate text-[13px] text-muted">
                    {f.range} · {f.facilityName} · {f.positionName}
                  </div>
                </div>
                {f.onWaitlist ? (
                  <Button size="sm" variant="quiet" disabled={!!busy} onClick={() => act(f.listingId, () => leaveWaitlistAction(f.shiftId))}>
                    On waitlist · Leave
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act(f.listingId, () => joinWaitlistAction(f.listingId))}>
                    Join waitlist
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
