"use client";

import { FormDialog } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { Checkbox } from "@/components/ui/primitives";
import { createPositionAction } from "../actions";

export function AddClassification() {
  return (
    <FormDialog title="Add job classification" action={createPositionAction} submitLabel="Add" trigger={<Button>Add classification</Button>}>
      <div className="grid grid-cols-[120px_1fr] gap-4">
        <TextField label="Code" name="code" placeholder="RN" required maxLength={12} autoFocus />
        <TextField label="Name" name="name" placeholder="Registered Nurse" required />
      </div>
      <Checkbox name="isClinical" value="true" label="Clinical classification" />
    </FormDialog>
  );
}
