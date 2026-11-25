"use client";

import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { Checkbox } from "@/components/ui/primitives";
import { confirmRulesAction, customizeRuleAction, removeFacilityRuleAction, updateOvertimeAction, updateRuleAction } from "../actions";

const OUTCOMES = [
  { value: "warning", label: "Warn, but allow" },
  { value: "approval_required", label: "Require manager approval" },
  { value: "hard_block", label: "Block" },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface RuleFormData {
  id: string;
  ruleType: string;
  outcome: string;
  overridable: boolean;
  isActive: boolean;
  params: Record<string, unknown>;
}

function paramValue(params: Record<string, unknown>, key: string): string {
  const [a, b] = key.split(".");
  const v = b ? (params[a] as Record<string, unknown> | undefined)?.[b] : params[a];
  return v === undefined || v === null ? "" : String(v);
}

export function RuleForm({ rule, fields, locked, editable }: { rule: RuleFormData; fields: { key: string; label: string; unit: string }[]; locked: boolean; editable: boolean }) {
  return (
    <ActionForm action={updateRuleAction} submitLabel={editable ? "Save" : undefined} submitVariant="secondary" className="space-y-4">
      <input type="hidden" name="ruleId" value={rule.id} />
      <input type="hidden" name="ruleType" value={rule.ruleType} />
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <SelectField label="When this rule is broken" name="outcome" defaultValue={rule.outcome} disabled={locked || !editable}>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        {fields.map((f) => (
          <TextField key={f.key} label={`${f.label} (${f.unit})`} name={`param:${f.key}`} type="number" min={1} step="0.5" defaultValue={paramValue(rule.params, f.key)} />
        ))}
      </fieldset>
      {locked ? (
        <p className="text-[12px] text-faint">Always enforced. The database prevents this too.</p>
      ) : (
        <div className="flex flex-wrap gap-x-6">
          <Checkbox name="overridable" label="Authorized managers may override" description="Overrides need an explanation and are audited." defaultChecked={rule.overridable} disabled={!editable} />
          <Checkbox name="isActive" label="Rule is on" defaultChecked={rule.isActive} disabled={!editable} />
        </div>
      )}
      {locked && (
        <>
          <input type="hidden" name="outcome" value="hard_block" />
          <input type="hidden" name="isActive" value="on" />
        </>
      )}
    </ActionForm>
  );
}

export function CustomizeButton({ ruleId, facilityId, label }: { ruleId: string; facilityId: string; label: string }) {
  return <ActionButton action={customizeRuleAction} label={label} variant="outline" hidden={{ ruleId, facilityId }} />;
}

export function RemoveFacilityRuleButton({ ruleId }: { ruleId: string }) {
  return <ActionButton action={removeFacilityRuleAction} label="Use organization rule" variant="quiet" hidden={{ ruleId }} />;
}

export function OvertimeForm({ ot, editable }: { ot: { weeklyThresholdHours: string | null; warningAtHours: string | null; workweekStartDay: number; outcome: string; overridable: boolean }; editable: boolean }) {
  return (
    <ActionForm action={updateOvertimeAction} submitLabel={editable ? "Save" : undefined} submitVariant="secondary" className="space-y-4">
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <TextField label="Overtime after (hours per week)" name="weeklyThresholdHours" type="number" step="0.5" defaultValue={ot.weeklyThresholdHours ?? ""} required />
        <TextField label="Early warning at (hours)" name="warningAtHours" type="number" step="0.5" defaultValue={ot.warningAtHours ?? ""} />
        <SelectField label="Workweek starts" name="workweekStartDay" defaultValue={String(ot.workweekStartDay)} hint="Must match how payroll defines the workweek">
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d} 12:00 AM
            </option>
          ))}
        </SelectField>
        <SelectField label="When an assignment creates overtime" name="outcome" defaultValue={ot.outcome}>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </fieldset>
      <Checkbox name="overridable" label="Authorized managers may override" defaultChecked={ot.overridable} disabled={!editable} />
    </ActionForm>
  );
}

export function ConfirmForm() {
  return (
    <ActionForm action={confirmRulesAction} submitLabel="Confirm rules">
      <TextAreaField label="What did you check these rules against?" name="statement" required placeholder="e.g. Ohio, Indiana and Kentucky labor rules; our PTO/overtime policy; no union contracts" />
    </ActionForm>
  );
}
