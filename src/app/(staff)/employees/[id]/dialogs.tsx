"use client";

import { Plus } from "lucide-react";
import { ActionButton, FormDialog } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { authorizeFacilityAction, inviteEmployeeAction, revokeAuthorizationAction, setPoolAction } from "../actions";

export function PoolDialog({ employeeId, isPool, name }: { employeeId: string; isPool: boolean; name: string }) {
  return (
    <FormDialog
      title={isPool ? "Remove from regional pool" : "Add to regional pool"}
      description={
        isPool
          ? `${name} will go back to their home facility only. Their facility authorizations stay in place.`
          : `${name} will see open shifts at every facility they're authorized for, and their hours will be tracked across all facilities. No duplicate record is created.`
      }
      action={setPoolAction}
      submitLabel={isPool ? "Remove from pool" : "Add to pool"}
      destructive={isPool}
      trigger={<Button variant={isPool ? "outline" : "secondary"}>{isPool ? "Remove from pool" : "Add to regional pool"}</Button>}
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="pool" value={String(!isPool)} />
      <TextAreaField label="Reason" name="reason" required minLength={3} placeholder="e.g. Approved by regional director for float coverage" />
    </FormDialog>
  );
}

export function AuthorizeDialog({ employeeId, facilities }: { employeeId: string; facilities: { id: string; name: string }[] }) {
  return (
    <FormDialog
      title="Authorize another facility"
      description="The employee will be able to see and claim eligible shifts at this facility."
      action={authorizeFacilityAction}
      submitLabel="Authorize"
      trigger={
        <Button size="sm" variant="outline">
          <Plus /> Facility
        </Button>
      }
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <SelectField label="Facility" name="facilityId" required defaultValue="">
        <option value="" disabled>
          Choose a facility
        </option>
        {facilities.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </SelectField>
      <TextAreaField label="Reason" name="reason" required minLength={3} placeholder="e.g. Cross-trained, approved by DON" />
    </FormDialog>
  );
}

export function RevokeButton({ employeeId, authorizationId }: { employeeId: string; authorizationId: string }) {
  return <ActionButton action={revokeAuthorizationAction} label="Revoke" variant="quiet" hidden={{ employeeId, authorizationId, reason: "Revoked from employee profile" }} />;
}

export function InviteDialog({ employeeId, email, hasPending }: { employeeId: string; email: string | null; hasPending: boolean }) {
  return (
    <FormDialog
      title={hasPending ? "Send a new invitation" : "Invite to the ShiftHQ app"}
      description="Creates a one-time link that lets the employee set a password. Their account is linked to this employee record; no separate registration needed."
      action={inviteEmployeeAction}
      submitLabel="Create invitation"
      trigger={<Button>{hasPending ? "Resend invitation" : "Invite to app"}</Button>}
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <TextField label="Email" name="email" type="email" defaultValue={email ?? ""} required hint="Used to sign in." />
    </FormDialog>
  );
}
