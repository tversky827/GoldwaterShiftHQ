"use client";

import { Copy } from "lucide-react";
import { ActionForm, FormDialog } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import { Checkbox } from "@/components/ui/primitives";
import { copyBudgetAction, createBudgetAction, updateBudgetAction } from "../../../budget-actions";

export function CopyBudgetDialog({ templateId, facilities }: { templateId: string; facilities: { id: string; name: string }[] }) {
  return (
    <FormDialog
      title="Copy to another facility"
      description="Copies every staffing number. Shifts are matched by code (missing shifts are created with the same times). The copy starts inactive so you can review it first."
      action={copyBudgetAction}
      submitLabel="Copy budget"
      trigger={
        <Button variant="secondary">
          <Copy /> Copy to facility
        </Button>
      }
    >
      <input type="hidden" name="templateId" value={templateId} />
      <SelectField label="Copy to" name="targetFacilityId" defaultValue="" required>
        <option value="" disabled>
          Choose a facility
        </option>
        {facilities.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </SelectField>
      <TextField label="Name (optional)" name="name" placeholder="Leave blank to keep the same name" />
    </FormDialog>
  );
}

export function BudgetDetailsForm({ facilityId, template, departments }: { facilityId: string; template: { id: string; name: string; departmentId: string | null; effectiveFrom: string; effectiveTo: string | null; isActive: boolean }; departments: { id: string; name: string }[] }) {
  return (
    <ActionForm action={updateBudgetAction} submitLabel="Save details" submitVariant="secondary">
      <input type="hidden" name="templateId" value={template.id} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <TextField label="Name" name="name" defaultValue={template.name} required />
      <SelectField label="Department" name="departmentId" defaultValue={template.departmentId ?? ""}>
        <option value="">Whole facility</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Effective from" name="effectiveFrom" type="date" defaultValue={template.effectiveFrom} required />
        <TextField label="Until (optional)" name="effectiveTo" type="date" defaultValue={template.effectiveTo ?? ""} />
      </div>
      <Checkbox name="isActive" label="Active" description="Active budgets generate shifts. If two overlap for the same department, the one that started most recently is used." defaultChecked={template.isActive} />
    </ActionForm>
  );
}

export function NewBudgetDialog({ facilityId, departments }: { facilityId: string; departments: { id: string; name: string }[] }) {
  return (
    <FormDialog title="New staffing budget" description="Set how many of each position you need, per shift and day of week." action={createBudgetAction} submitLabel="Create and edit" trigger={<Button>New budget</Button>}>
      <input type="hidden" name="facilityId" value={facilityId} />
      <TextField label="Name" name="name" placeholder="Nursing – winter census" required autoFocus />
      <SelectField label="Department" name="departmentId" defaultValue={departments[0]?.id ?? ""}>
        <option value="">Whole facility</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Effective from" name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        <TextField label="Until (optional)" name="effectiveTo" type="date" />
      </div>
    </FormDialog>
  );
}
