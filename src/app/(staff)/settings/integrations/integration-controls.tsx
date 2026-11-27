"use client";

import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/fields";
import { saveMappingAction, syncNowAction, testConnectionAction } from "../actions";

export function ConnectionButtons({ provider, canSync }: { provider: "paycor" | "aod"; canSync: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionButton action={testConnectionAction} label="Test connection" pendingLabel="Testing…" variant="outline" hidden={{ provider }} />
      {canSync && <ActionButton action={syncNowAction} label="Sync now" pendingLabel="Syncing…" hidden={{ provider }} />}
    </div>
  );
}

export function MapValueForm({
  sourceType,
  sourceValue,
  facilities,
  positions,
}: {
  sourceType: "location" | "legal_entity" | "position" | "department";
  sourceValue?: string;
  facilities: { id: string; name: string; departments: { id: string; name: string }[] }[];
  positions: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={saveMappingAction} submitLabel="Save mapping" className="space-y-3">
      <input type="hidden" name="provider" value="paycor" />
      <input type="hidden" name="sourceType" value={sourceType} />
      {sourceValue ? <input type="hidden" name="sourceValue" value={sourceValue} /> : <TextField label={sourceType === "legal_entity" ? "Paycor legal entity ID" : `Paycor ${sourceType} (exact text)`} name="sourceValue" inputMode={sourceType === "legal_entity" ? "numeric" : undefined} required />}
      {(sourceType === "location" || sourceType === "legal_entity") && (
        <SelectField label="Maps to facility" name="facilityId" defaultValue="" required>
          <option value="" disabled>
            Choose a facility
          </option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </SelectField>
      )}
      {sourceType === "position" && (
        <SelectField label="Maps to job classification" name="positionId" defaultValue="" required>
          <option value="" disabled>
            Choose a classification
          </option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      )}
      {sourceType === "department" && (
        <SelectField label="Maps to department" name="departmentId" defaultValue="" required>
          <option value="" disabled>
            Choose a department
          </option>
          {facilities.map((f) => (
            <optgroup key={f.id} label={f.name}>
              {f.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
      )}
    </ActionForm>
  );
}
