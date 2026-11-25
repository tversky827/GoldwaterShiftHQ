"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { ActionButton, FormDialog } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/fields";
import { grantRoleAction, inviteUserAction, resendInviteAction, revokeRoleAction, setUserDisabledAction } from "../actions";

export interface RoleOption {
  id: string;
  name: string;
  key: string;
  defaultScope: "organization" | "facility" | "department" | "pool";
  description: string;
}
export interface FacilityOption {
  id: string;
  name: string;
  departments: { id: string; name: string }[];
}

const SCOPE_LABEL = { organization: "All facilities", facility: "One facility", department: "One department", pool: "Regional pool" } as const;

function ScopeFields({ roles, facilities }: { roles: RoleOption[]; facilities: FacilityOption[] }) {
  const staffRoles = roles.filter((r) => r.key !== "employee");
  const [roleId, setRoleId] = useState(staffRoles[0]?.id ?? "");
  const role = roles.find((r) => r.id === roleId);
  const [scope, setScope] = useState<string>(role?.defaultScope ?? "facility");
  const [facilityId, setFacilityId] = useState("");
  const fac = facilities.find((f) => f.id === facilityId);
  return (
    <>
      <SelectField
        label="Role"
        name="roleId"
        value={roleId}
        onChange={(e) => {
          setRoleId(e.target.value);
          setScope(roles.find((r) => r.id === e.target.value)?.defaultScope ?? "facility");
        }}
        hint={role?.description}
      >
        {staffRoles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Access to" name="scopeType" value={scope} onChange={(e) => setScope(e.target.value)}>
        {Object.entries(SCOPE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectField>
      {(scope === "facility" || scope === "department") && (
        <SelectField label="Facility" name="facilityId" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required>
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
      {scope === "department" && (
        <SelectField label="Department" name="departmentId" defaultValue="" required>
          <option value="" disabled>
            {fac ? "Choose a department" : "Choose a facility first"}
          </option>
          {fac?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
      )}
    </>
  );
}

export function InviteUserDialog({ roles, facilities }: { roles: RoleOption[]; facilities: FacilityOption[] }) {
  return (
    <FormDialog title="Invite a staff member" description="They’ll get a one-time link to set their password. To give an employee the mobile app, invite them from their employee profile instead." action={inviteUserAction} submitLabel="Create invitation" trigger={<Button>Invite user</Button>}>
      <TextField label="Full name" name="displayName" required autoFocus />
      <TextField label="Work email" name="email" type="email" required />
      <ScopeFields roles={roles} facilities={facilities} />
    </FormDialog>
  );
}

export function AddRoleDialog({ userId, name, roles, facilities }: { userId: string; name: string; roles: RoleOption[]; facilities: FacilityOption[] }) {
  return (
    <FormDialog
      title={`Add a role for ${name}`}
      action={grantRoleAction}
      submitLabel="Add role"
      trigger={
        <Button size="sm" variant="ghost">
          <Plus /> Role
        </Button>
      }
    >
      <input type="hidden" name="userId" value={userId} />
      <ScopeFields roles={roles} facilities={facilities} />
    </FormDialog>
  );
}

export function RevokeRoleButton({ userRoleId }: { userRoleId: string }) {
  return <ActionButton action={revokeRoleAction} label="Remove" variant="quiet" hidden={{ userRoleId }} />;
}

export function DisableUserButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  return <ActionButton action={setUserDisabledAction} label={disabled ? "Enable" : "Disable"} variant="quiet" hidden={{ userId, disabled: String(!disabled) }} />;
}

export function ResendInviteButton({ userId }: { userId: string }) {
  return <ActionButton action={resendInviteAction} label="New invite link" variant="quiet" hidden={{ userId }} />;
}
