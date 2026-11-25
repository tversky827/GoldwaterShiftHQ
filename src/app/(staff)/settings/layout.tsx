import type { ReactNode } from "react";
import { NavLink } from "@/components/nav-link";
import { requireStaff } from "@/server/context";
import { can, hasOrgWide } from "@/server/rbac/access";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  const items = [
    hasOrgWide(actor, "users.view") && { href: "/settings/users", label: "Users & access" },
    hasOrgWide(actor, "roles.manage") && { href: "/settings/roles", label: "Roles" },
    can(actor, "rules.view") && { href: "/settings/rules", label: "Rules" },
    can(actor, "marketplace.manage") && { href: "/settings/marketplace", label: "Marketplace" },
    hasOrgWide(actor, "integrations.view") && { href: "/settings/integrations", label: "Integrations" },
    can(actor, "facilities.view") && { href: "/settings/classifications", label: "Classifications" },
    can(actor, "audit.view") && { href: "/settings/audit", label: "Audit log" },
    { href: "/settings/notifications", label: "My notifications" },
  ].filter(Boolean) as { href: string; label: string }[];
  return (
    <div>
      <h1 className="mb-5 text-[28px] font-semibold tracking-tight sm:text-[32px]">Settings</h1>
      <nav className="-mx-1 mb-8 flex gap-1 overflow-x-auto border-b border-line pb-3" aria-label="Settings">
        {items.map((i) => (
          <NavLink key={i.href} href={i.href} className="whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] text-ink-2 hover:bg-fill" activeClassName="bg-ink text-white hover:bg-ink">
            {i.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
