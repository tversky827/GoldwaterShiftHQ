import { CalendarDays, CalendarPlus, Clock4, House, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DemoBanner } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { requireActor } from "@/server/context";
import { isStaff } from "@/server/rbac/access";

const TABS = [
  { href: "/app", label: "Home", icon: House, exact: true },
  { href: "/app/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/app/shifts", label: "Pick Up", icon: CalendarPlus },
  { href: "/app/availability", label: "Availability", icon: Clock4 },
  { href: "/app/profile", label: "Profile", icon: UserRound },
];

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  if (!actor.employeeId) redirect(isStaff(actor) ? "/overview" : "/forbidden");
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      {actor.isDemo && <DemoBanner />}
      {isStaff(actor) && (
        <div className="px-5 pt-3 text-right">
          <Link href="/overview" className="text-[13px] font-medium text-accent">
            Switch to staff view
          </Link>
        </div>
      )}
      <main className="flex-1 px-5 pb-28 pt-6">{children}</main>
      <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line" aria-label="App">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {TABS.map(({ href, label, icon: Icon, exact }) => (
            <NavLink key={href} href={href} exact={exact} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-faint" activeClassName="text-accent">
              <Icon className="size-6" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
