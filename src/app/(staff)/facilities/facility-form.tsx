"use client";

import { ActionForm, type FormState } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/fields";
import { Checkbox } from "@/components/ui/primitives";

interface FacilityValues {
  id?: string;
  name?: string;
  code?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  timezone?: string;
  licensedBeds?: number | null;
  isActive?: boolean;
}

export function FacilityForm({
  action,
  values = {},
  timezones,
  submitLabel,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  values?: FacilityValues;
  timezones: { value: string; label: string }[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {values.id && <input type="hidden" name="facilityId" value={values.id} />}
      <div className="grid gap-5 sm:grid-cols-[1fr_160px]">
        <TextField label="Facility name" name="name" defaultValue={values.name} placeholder="e.g. Maple Grove Health & Rehabilitation" required />
        <TextField label="Short code" name="code" defaultValue={values.code} placeholder="MGR" hint="Shown on schedules" required maxLength={10} />
      </div>
      <TextField label="Street address" name="addressLine1" defaultValue={values.addressLine1 ?? ""} autoComplete="address-line1" />
      <TextField label="Address line 2" name="addressLine2" defaultValue={values.addressLine2 ?? ""} autoComplete="address-line2" />
      <div className="grid gap-5 sm:grid-cols-[1fr_90px_130px]">
        <TextField label="City" name="city" defaultValue={values.city ?? ""} autoComplete="address-level2" />
        <TextField label="State" name="state" defaultValue={values.state ?? ""} maxLength={2} autoComplete="address-level1" />
        <TextField label="ZIP" name="postalCode" defaultValue={values.postalCode ?? ""} autoComplete="postal-code" />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <SelectField label="Time zone" name="timezone" defaultValue={values.timezone ?? "America/New_York"} hint="Schedules display in this time zone">
          {timezones.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Phone" name="phone" type="tel" defaultValue={values.phone ?? ""} />
        <TextField label="Licensed beds" name="licensedBeds" type="number" min={0} defaultValue={values.licensedBeds ?? ""} />
      </div>
      {values.id && <Checkbox name="isActive" label="Facility is active" description="Inactive facilities are hidden from scheduling but keep all history." defaultChecked={values.isActive ?? true} />}
    </ActionForm>
  );
}
