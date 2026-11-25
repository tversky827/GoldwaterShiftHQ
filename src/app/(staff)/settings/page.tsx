import { redirect } from "next/navigation";
import { requireStaff } from "@/server/context";
import { can, hasOrgWide } from "@/server/rbac/access";

export default async function SettingsIndex() {
  const actor = await requireStaff();
  if (hasOrgWide(actor, "users.view")) redirect("/settings/users");
  if (hasOrgWide(actor, "integrations.view")) redirect("/settings/integrations");
  if (can(actor, "rules.view")) redirect("/settings/rules");
  if (can(actor, "audit.view")) redirect("/settings/audit");
  if (can(actor, "facilities.view")) redirect("/settings/classifications");
  redirect("/settings/notifications");
}
