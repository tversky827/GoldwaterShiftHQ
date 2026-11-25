import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { cn } from "@/lib/utils";
import { requireStaff } from "@/server/context";
import { hasOrgWide } from "@/server/rbac/access";
import { listRolesWithPermissions } from "@/server/users";
import { RolePermissionsForm } from "./role-form";

export const metadata = { title: "Roles" };
export const dynamic = "force-dynamic";

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const actor = await requireStaff();
  if (!hasOrgWide(actor, "roles.manage")) redirect("/forbidden");
  const { role: roleKey } = await searchParams;
  const { roles, permissions } = await listRolesWithPermissions(await getDb(), actor);
  const selected = roles.find((r) => r.key === roleKey) ?? roles.find((r) => r.key === "scheduler") ?? roles[0];
  const groups = new Map<string, { key: string; description: string }[]>();
  for (const p of permissions) groups.set(p.category, [...(groups.get(p.category) ?? []), { key: p.key, description: p.description }]);
  const isEmployeeRole = selected?.key === "employee";

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit p-2">
        {roles.map((r) => (
          <Link key={r.id} href={`/settings/roles?role=${r.key}`} className={cn("block rounded-xl px-4 py-3 transition-colors", r.id === selected?.id ? "bg-fill" : "hover:bg-fill/60")}>
            <div className="text-[15px] font-medium">{r.name}</div>
            <div className="text-[12px] text-muted">{r.permissions.size} permissions</div>
          </Link>
        ))}
      </Card>
      {selected && (
        <Card>
          <CardHeader title={selected.name} description={selected.description} action={selected.isSystem && <Badge>Default role</Badge>} />
          <CardBody>
            <RolePermissionsForm
              roleId={selected.id}
              groups={[...groups.entries()].map(([category, perms]) => ({
                category,
                perms: perms.map((p) => ({ ...p, checked: selected.permissions.has(p.key), disabled: isEmployeeRole ? !p.key.startsWith("self.") : p.key.startsWith("self.") })),
              }))}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
