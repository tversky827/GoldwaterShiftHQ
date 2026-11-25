import { asc, eq, inArray } from "drizzle-orm";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { departments, roles } from "@/db/schema";
import { relativeTime } from "@/lib/format";
import { requireStaff } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { hasOrgWide } from "@/server/rbac/access";
import { listUsers } from "@/server/users";
import { redirect } from "next/navigation";
import { AddRoleDialog, DisableUserButton, InviteUserDialog, ResendInviteButton, RevokeRoleButton } from "./user-dialogs";

export const metadata = { title: "Users & access" };
export const dynamic = "force-dynamic";

const SCOPE = { organization: "All facilities", pool: "Regional pool" } as const;

export default async function UsersPage() {
  const actor = await requireStaff();
  if (!hasOrgWide(actor, "users.view")) redirect("/forbidden");
  const db = await getDb();
  const [userList, roleRows, facs] = await Promise.all([listUsers(db, actor), db.select().from(roles).where(eq(roles.organizationId, actor.organizationId)).orderBy(asc(roles.name)), listFacilities(db, actor)]);
  const depts = facs.length ? await db.select().from(departments).where(inArray(departments.facilityId, facs.map((f) => f.id))).orderBy(asc(departments.sortOrder)) : [];
  const facilityOptions = facs.map((f) => ({ id: f.id, name: f.name, departments: depts.filter((d) => d.facilityId === f.id).map((d) => ({ id: d.id, name: d.name })) }));
  const roleOptions = roleRows.map((r) => ({ id: r.id, name: r.name, key: r.key, defaultScope: r.defaultScope, description: r.description }));
  const manage = hasOrgWide(actor, "users.manage");
  const staff = userList.filter((u) => u.grants.some((g) => g.roleKey !== "employee"));
  const employeesOnly = userList.length - staff.length;

  return (
    <Card>
      <CardHeader title="Staff users" description={`${staff.length} staff users · ${employeesOnly} employees using the app (manage them from their employee profile)`} action={manage && <InviteUserDialog roles={roleOptions} facilities={facilityOptions} />} />
      <ul className="mt-3 divide-y divide-line">
        {staff.map((u) => (
          <li key={u.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={u.displayName} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium">{u.displayName}</span>
                  {u.status === "invited" && <Badge tone="caution">Invited</Badge>}
                  {u.status === "disabled" && <Badge tone="critical">Disabled</Badge>}
                </div>
                <div className="truncate text-[13px] text-muted">
                  {u.email} · last sign-in {relativeTime(u.lastLoginAt)}
                </div>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              {u.grants
                .filter((g) => g.roleKey !== "employee")
                .map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center gap-2 text-[14px]">
                    <Badge tone="accent">{g.roleName}</Badge>
                    <span className="text-ink-2">{g.scopeType === "organization" || g.scopeType === "pool" ? SCOPE[g.scopeType] : g.scopeType === "department" ? `${g.facilityName} · ${g.departmentName}` : g.facilityName}</span>
                    {manage && <RevokeRoleButton userRoleId={g.id} />}
                  </div>
                ))}
            </div>
            {manage && (
              <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                <AddRoleDialog userId={u.id} name={u.displayName} roles={roleOptions} facilities={facilityOptions} />
                {u.status === "invited" && <ResendInviteButton userId={u.id} />}
                {u.id !== actor.userId && <DisableUserButton userId={u.id} disabled={u.status === "disabled"} />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
