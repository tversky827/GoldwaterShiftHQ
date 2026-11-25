"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ActionButton, FormDialog } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField } from "@/components/ui/fields";
import { Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { decideSwapAction, publishAction, recordCalloutAction, reviewClaimAction, withdrawAction } from "./actions";

export function FacilityPicker({ facilities, current }: { facilities: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  if (facilities.length < 2) return null;
  return (
    <Select aria-label="Facility" className="w-auto min-w-56" value={current} onChange={(e) => router.push(`/open-shifts?facilityId=${e.target.value}`)}>
      {facilities.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </Select>
  );
}

export interface UnlistedShift {
  id: string;
  day: string;
  dayKey: string;
  time: string;
  position: string;
  department: string | null;
  open: number;
}

export function PublishDialog({ shifts, timezone, defaultExpiry, defaultApproval }: { shifts: UnlistedShift[]; timezone: string; defaultExpiry: number; defaultApproval: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState("now");
  const [position, setPosition] = useState("");
  const positions = useMemo(() => [...new Set(shifts.map((s) => s.position))].sort(), [shifts]);
  const visible = shifts.filter((s) => !position || s.position === position);
  const byDay = useMemo(() => {
    const m = new Map<string, UnlistedShift[]>();
    for (const s of visible) m.set(s.day, [...(m.get(s.day) ?? []), s]);
    return [...m.entries()];
  }, [visible]);
  const toggle = (id: string) => setSelected((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));

  return (
    <FormDialog
      title="Publish open shifts"
      description="Qualified employees see these in the Pick Up tab and get a notification. Each pick-up runs through the same rules as a scheduler assignment."
      action={publishAction}
      submitLabel={selected.size ? `Publish ${selected.size} shift${selected.size === 1 ? "" : "s"}` : "Publish"}
      trigger={<Button disabled={!shifts.length}>Publish open shifts</Button>}
    >
      <input type="hidden" name="timezone" value={timezone} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="shiftId" value={id} />
      ))}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink-2">Unfilled shifts, next 14 days</span>
          <div className="flex items-center gap-2">
            {positions.length > 1 && (
              <Select aria-label="Position" className="h-8 w-auto py-0 text-[13px]" value={position} onChange={(e) => setPosition(e.target.value)}>
                <option value="">All positions</option>
                {positions.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            )}
            <Button type="button" size="sm" variant="quiet" onClick={() => setSelected((p) => { const n = new Set(p); for (const s of visible) { if (allVisibleSelected) n.delete(s.id); else n.add(s.id); } return n; })}>
              {allVisibleSelected ? "Clear" : "Select all"}
            </Button>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
          {byDay.map(([d, list]) => (
            <div key={d}>
              <div className="sticky top-0 bg-fill px-3 py-1.5 text-[12px] font-medium text-muted">{d}</div>
              {list.map((s) => (
                <label key={s.id} className={cn("flex cursor-pointer items-center gap-3 border-t border-line/70 px-3 py-2 text-[14px]", selected.has(s.id) && "bg-accent-soft/50")}>
                  <input type="checkbox" className="size-[18px] accent-[var(--color-accent)]" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="w-12 font-medium">{s.position}</span>
                  <span className="tabular flex-1 text-ink-2">{s.time}</span>
                  <span className="text-[12px] text-muted">{s.open} open</span>
                </label>
              ))}
            </div>
          ))}
          {!visible.length && <p className="px-3 py-6 text-center text-[14px] text-muted">Every upcoming shift is staffed or already listed.</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="When" name="when" value={when} onChange={(e) => setWhen(e.target.value)}>
          <option value="now">Publish now</option>
          <option value="later">Schedule for later</option>
        </SelectField>
        <SelectField label="Closes" name="expiryHoursBefore" defaultValue={String(defaultExpiry)} hint="Stops accepting pick-ups this long before the shift">
          {[0, 1, 2, 4, 8, 12, 24, 48].map((h) => (
            <option key={h} value={h}>
              {h === 0 ? "At shift start" : `${h} hour${h === 1 ? "" : "s"} before`}
            </option>
          ))}
        </SelectField>
      </div>
      {when === "later" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="publishDate">
            <Input id="publishDate" name="publishDate" type="date" required />
          </Field>
          <Field label="Time" htmlFor="publishTime" hint="Facility local time">
            <Input id="publishTime" name="publishTime" type="time" required defaultValue="09:00" />
          </Field>
        </div>
      )}
      <SelectField label="Who can pick up" name="audience" defaultValue="authorized" hint="Authorized staff includes regional pool members cleared for this facility">
        <option value="authorized">Facility staff + authorized staff and pool</option>
        <option value="home">This facility’s own staff only</option>
      </SelectField>
      <Field label="Incentive (optional)" htmlFor="incentiveText" hint="Shown on the shift, e.g. “$5/hr bonus”">
        <Input id="incentiveText" name="incentiveText" maxLength={140} placeholder="e.g. $5/hr bonus" />
      </Field>
      <Checkbox name="requiresApproval" defaultChecked={defaultApproval} label="Review every pick-up" description="Otherwise pick-ups that pass every rule are assigned instantly; anything needing approval still comes to you." />
    </FormDialog>
  );
}

export function WithdrawButton({ listingId }: { listingId: string }) {
  return <ActionButton action={withdrawAction} label="Withdraw" variant="quiet" hidden={{ listingId, reason: "Withdrawn from Open shifts" }} />;
}

function DecisionFields({ reasons }: { reasons: string[] }) {
  const [decision, setDecision] = useState("approve");
  return (
    <>
      {reasons.length > 0 && (
        <ul className="space-y-1.5 rounded-xl bg-caution-soft px-4 py-3 text-[14px] text-caution">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="inline-flex rounded-full bg-fill p-1 text-[14px]" role="radiogroup" aria-label="Decision">
        {[
          { v: "approve", l: "Approve" },
          { v: "reject", l: "Decline" },
        ].map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={decision === o.v} onClick={() => setDecision(o.v)} className={cn("rounded-full px-4 py-1.5", decision === o.v ? "bg-surface font-medium shadow-card" : "text-ink-2")}>
            {o.l}
          </button>
        ))}
      </div>
      <input type="hidden" name="decision" value={decision} />
      <TextAreaField
        label={decision === "approve" ? (reasons.length ? "Explanation (required to approve these exceptions)" : "Note (optional)") : "Note to the employee (optional)"}
        name="reason"
        required={decision === "approve" && reasons.length > 0}
        minLength={decision === "approve" && reasons.length > 0 ? 5 : undefined}
        placeholder={decision === "approve" ? "e.g. Short-staffed for the weekend; DON approved overtime" : "e.g. We need someone with wound-care training"}
      />
    </>
  );
}

export function ReviewClaimDialog({ claimId, who, shift, reasons }: { claimId: string; who: string; shift: string; reasons: string[] }) {
  return (
    <FormDialog title={`Review ${who}’s pick-up`} description={shift} action={reviewClaimAction} submitLabel="Confirm" trigger={<Button size="sm" variant="outline">Review</Button>}>
      <input type="hidden" name="claimId" value={claimId} />
      <DecisionFields reasons={reasons} />
    </FormDialog>
  );
}

export function SwapDecisionDialog({ swapId, title, description }: { swapId: string; title: string; description: string }) {
  return (
    <FormDialog title={title} description={description} action={decideSwapAction} submitLabel="Confirm" trigger={<Button size="sm" variant="outline">Review</Button>}>
      <input type="hidden" name="swapId" value={swapId} />
      <DecisionFields reasons={[]} />
      <p className="text-[12px] text-faint">Every rule is checked again for both people when you approve. If an exception needs your sign-off, you’ll be asked for an explanation.</p>
    </FormDialog>
  );
}

export function CalloutDialog({ assignments }: { assignments: { id: string; label: string }[] }) {
  return (
    <FormDialog
      title="Record a callout"
      description="The shift is posted for pick-up right away and qualified staff are notified. If nobody picks it up, it escalates automatically."
      action={recordCalloutAction}
      submitLabel="Record callout"
      trigger={<Button size="sm" variant="outline" disabled={!assignments.length}>Record callout</Button>}
    >
      <SelectField label="Who called out" name="assignmentId" required defaultValue="">
        <option value="" disabled>
          Choose a shift in the next 3 days
        </option>
        {assignments.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </SelectField>
      <TextAreaField label="Reason" name="reason" required minLength={3} placeholder="e.g. Called at 5:10 am, sick" />
    </FormDialog>
  );
}
