"use client";

import { useRouter } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { resetMarketplaceSettingsAction, saveMarketplaceSettingsAction } from "../../open-shifts/actions";

export interface SettingsValues {
  autoPublish: boolean;
  autoPublishHoursBefore: number;
  expiryHoursBefore: number;
  requireApproval: boolean;
  escalationMinutes: number[];
  source: string;
}

export function ScopePicker({ scopes, current }: { scopes: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <Select aria-label="Applies to" className="w-auto min-w-64" value={current} onChange={(e) => router.push(`/settings/marketplace${e.target.value ? `?facilityId=${e.target.value}` : ""}`)}>
      {scopes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}

export function MarketplaceSettingsForm({ facilityId, values, canEdit }: { facilityId: string | null; values: SettingsValues; canEdit: boolean }) {
  return (
    <ActionForm key={`${facilityId}-${values.source}`} action={saveMarketplaceSettingsAction} submitLabel={canEdit ? "Save" : undefined} footer={facilityId && values.source === "facility" && canEdit ? <ActionButton action={resetMarketplaceSettingsAction} label="Use organization default" variant="quiet" hidden={{ facilityId }} /> : undefined}>
      <fieldset disabled={!canEdit} className="space-y-6">
        <input type="hidden" name="facilityId" value={facilityId ?? ""} />
        <section className="space-y-3">
          <h3 className="text-[15px] font-semibold">Automatic publishing</h3>
          <Checkbox name="autoPublish" defaultChecked={values.autoPublish} label="Publish unfilled shifts automatically" description="Only shifts on published schedules. A listing you withdraw is never re-posted automatically." />
          <Field label="Publish this many hours before the shift" htmlFor="autoPublishHoursBefore">
            <Input id="autoPublishHoursBefore" name="autoPublishHoursBefore" type="number" min={1} max={720} defaultValue={values.autoPublishHoursBefore} className="w-32" />
          </Field>
        </section>
        <section className="space-y-3">
          <h3 className="text-[15px] font-semibold">Pick-ups</h3>
          <Field label="Close listings this many hours before the shift" htmlFor="expiryHoursBefore" hint="0 = accept pick-ups until the shift starts">
            <Input id="expiryHoursBefore" name="expiryHoursBefore" type="number" min={0} max={72} defaultValue={values.expiryHoursBefore} className="w-32" />
          </Field>
          <Checkbox name="requireApproval" defaultChecked={values.requireApproval} label="Review every pick-up by default" description="When off, pick-ups that pass every rule are assigned instantly. Anything a rule says needs approval (for example overtime) always comes to a reviewer." />
        </section>
        <section className="space-y-3">
          <h3 className="text-[15px] font-semibold">Callout escalation</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Widen to other facilities and the pool after (minutes)" htmlFor="escalate1">
              <Input id="escalate1" name="escalate1" type="number" min={5} max={1440} defaultValue={values.escalationMinutes[0]} />
            </Field>
            <Field label="Then alert leadership after (minutes)" htmlFor="escalate2">
              <Input id="escalate2" name="escalate2" type="number" min={5} max={1440} defaultValue={values.escalationMinutes[1]} />
            </Field>
          </div>
        </section>
      </fieldset>
    </ActionForm>
  );
}
