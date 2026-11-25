import { Building2, CalendarDays, CalendarPlus, LayoutGrid, LogOut, Settings, Smartphone, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark, DemoBanner } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { Avatar } from "@/components/ui/primitives";
import { requireStaff } from "@/server/context";
import { kickBackgroundJobs } from "@/server/marketplace/background";
import { hasMarketplaceAccess } from "@/server/marketplace/listings";
import { can, hasOrgWide, type Actor } from "@/server/rbac/access";
import { signOutAction } from "../(public)/actions";

function navFor(actor: Actor) {
  const items: { href: string; label: string; icon: ReactNode }[] = [];
  if (can(actor, "facilities.view")) items.push({ href: "/overview", label: "Overview", icon: <LayoutGrid /> });
  if (can(actor, "schedules.view")) items.push({ href: "/schedule", label: "Schedule", icon: <CalendarDays /> });
  if (hasMarketplaceAccess(actor)) items.push({ href: "/open-shifts", label: "Open shifts", icon: <CalendarPlus /> });
  if (can(actor, "facilities.view")) items.push({ href: "/facilities", label: "Facilities", icon: <Building2 /> });
  if (can(actor, "employees.view")) items.push({ href: "/employees", label: "Employees", icon: <Users /> });
  items.push({ href: "/settings", label: "Settings", icon: <Settings /> });
  return items;
}

function roleSummary(actor: Actor) {
  const names = [...new Set(actor.grants.filter((g) => g.roleKey !== "employee").map((g) => g.roleName))];
  return names.join(", ") || "Staff";
}

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaff();
  kickBackgroundJobs();
  const nav = navFor(actor);
  return (
    <div className="min-h-dvh">
      {actor.isDemo && <DemoBanner />}
      <div className="lg:flex">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-surface/70 px-3 py-5 lg:flex">
          <Link href="/" className="mb-6 flex items-center gap-2.5 px-3">
            <BrandMark className="size-7" />
            <span className="text-[17px] font-semibold tracking-tight">ShiftHQ</span>
          </Link>
          <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
            {nav.map((n) => (
              <NavLink
                key={n.href}
                href={n.href}
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] text-ink-2 transition-colors hover:bg-fill [&_svg]:size-[18px] [&_svg]:text-muted"
                activeClassName="bg-fill font-medium text-ink [&_svg]:text-accent"
              >
                {n.icon}
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-line pt-4">
            <div className="flex items-center gap-3 px-3">
              <Avatar name={actor.displayName} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{actor.displayName}</div>
                <div className="truncate text-[12px] text-muted">{roleSummary(actor)}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-0.5">
              {actor.employeeId && (
                <Link href="/app" className="flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-ink-2 hover:bg-fill [&_svg]:size-4 [&_svg]:text-muted">
                  <Smartphone /> My schedule
                </Link>
              )}
              <form action={signOutAction}>
                <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-ink-2 hover:bg-fill [&_svg]:size-4 [&_svg]:text-muted">
                  <LogOut /> Sign out
                </button>
              </form>
            </div>
          </div>
        </aside>

        {/* Top bar (tablet / phone) */}
        <header className="glass sticky top-0 z-30 border-b border-line lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <BrandMark className="size-7" />
              <span className="text-[17px] font-semibold tracking-tight">ShiftHQ</span>
            </Link>
            <form action={signOutAction}>
              <button className="rounded-full p-2 text-muted hover:bg-fill" aria-label="Sign out">
                <LogOut className="size-5" />
              </button>
            </form>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
            {nav.map((n) => (
              <NavLink key={n.href} href={n.href} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] text-ink-2" activeClassName="bg-ink text-white">
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
