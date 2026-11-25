"use client";

import { ActionForm } from "@/components/ui/action-form";
import { Checkbox } from "@/components/ui/primitives";
import { setRolePermissionsAction } from "../actions";

export function RolePermissionsForm({ roleId, groups }: { roleId: string; groups: { category: string; perms: { key: string; description: string; checked: boolean; disabled: boolean }[] }[] }) {
  return (
    <ActionForm key={roleId} action={setRolePermissionsAction} submitLabel="Save permissions">
      <input type="hidden" name="roleId" value={roleId} />
      <p className="text-[13px] text-muted">Facility-level roles only apply within the facilities or departments each person is assigned to. Employee self-service permissions are kept separate from staff permissions.</p>
      <div className="grid gap-6 md:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g.category}>
            <legend className="mb-1 text-[12px] font-medium uppercase tracking-wide text-faint">{g.category}</legend>
            {g.perms.map((p) => (
              <Checkbox key={p.key} name="permission" value={p.key} defaultChecked={p.checked} disabled={p.disabled} label={p.description} description={p.key} />
            ))}
          </fieldset>
        ))}
      </div>
    </ActionForm>
  );
}
