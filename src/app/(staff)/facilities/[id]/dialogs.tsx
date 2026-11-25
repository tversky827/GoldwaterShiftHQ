"use client";

import { Plus } from "lucide-react";
import { ActionButton, ActionForm, FormDialog } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { Checkbox } from "@/components/ui/primitives";
import { addDepartmentAction, addShiftTemplateAction, addUnitAction, setPositionsAction, toggleDepartmentAction, toggleShiftTemplateAction } from "../actions";

export function AddDepartment({ facilityId }: { facilityId: string }) {
  return (
    <FormDialog
      title="Add department"
      description="Departments group units and staff, e.g. Nursing or Dietary."
      action={addDepartmentAction}
      submitLabel="Add department"
      trigger={
        <Button size="sm" variant="outline">
          <Plus /> Department
        </Button>
      }
    >
      <input type="hidden" name="facilityId" value={facilityId} />
      <TextField label="Name" name="name" placeholder="Nursing" required autoFocus />
      <TextField label="Code (optional)" name="code" placeholder="NUR" />
      <Checkbox name="isClinical" value="true" label="Clinical department" description="Clinical departments can require licenses and certifications." />
    </FormDialog>
  );
}

export function AddUnit({ facilityId, departmentId, departmentName }: { facilityId: string; departmentId: string; departmentName: string }) {
  return (
    <FormDialog
      title={`Add a unit to ${departmentName}`}
      description="Units are wings, floors or neighborhoods, e.g. East Wing or Memory Care."
      action={addUnitAction}
      submitLabel="Add unit"
      trigger={
        <Button size="sm" variant="ghost">
          <Plus /> Unit
        </Button>
      }
    >
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <TextField label="Unit name" name="name" placeholder="East Wing" required autoFocus />
    </FormDialog>
  );
}

export function ToggleDepartment({ facilityId, departmentId, active }: { facilityId: string; departmentId: string; active: boolean }) {
  return <ActionButton action={toggleDepartmentAction} label={active ? "Deactivate" : "Activate"} variant="quiet" hidden={{ facilityId, departmentId, active: String(!active) }} />;
}

export function AddShift({ facilityId }: { facilityId: string }) {
  return (
    <FormDialog
      title="Add shift"
      description="Shifts are the building blocks of staffing budgets and schedules. Times are in the facility’s local time."
      action={addShiftTemplateAction}
      submitLabel="Add shift"
      trigger={
        <Button size="sm" variant="outline">
          <Plus /> Shift
        </Button>
      }
    >
      <input type="hidden" name="facilityId" value={facilityId} />
      <div className="grid grid-cols-[1fr_120px] gap-4">
        <TextField label="Name" name="name" placeholder="Day" required autoFocus />
        <TextField label="Code" name="code" placeholder="DAY" required maxLength={10} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <TextField label="Starts" name="startTime" type="time" defaultValue="07:00" required />
        <TextField label="Ends" name="endTime" type="time" defaultValue="15:00" required hint="Earlier than start = overnight" />
        <TextField label="Unpaid break (min)" name="unpaidBreakMinutes" type="number" min={0} max={240} defaultValue={0} />
      </div>
    </FormDialog>
  );
}

export function ToggleShift({ facilityId, templateId, active }: { facilityId: string; templateId: string; active: boolean }) {
  return <ActionButton action={toggleShiftTemplateAction} label={active ? "Deactivate" : "Activate"} variant="quiet" hidden={{ facilityId, templateId, active: String(!active) }} />;
}

export function PositionsForm({ facilityId, positions }: { facilityId: string; positions: { id: string; code: string; name: string; enabled: boolean; isClinical: boolean }[] }) {
  return (
    <ActionForm action={setPositionsAction} submitLabel="Save classifications">
      <input type="hidden" name="facilityId" value={facilityId} />
      <div className="grid gap-x-6 sm:grid-cols-2">
        {positions.map((p) => (
          <Checkbox key={p.id} name="positionId" value={p.id} defaultChecked={p.enabled} label={`${p.name} (${p.code})`} description={p.isClinical ? "Clinical" : undefined} />
        ))}
      </div>
    </ActionForm>
  );
}
