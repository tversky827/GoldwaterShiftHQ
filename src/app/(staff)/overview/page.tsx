import { ArrowUpRight, Building2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { timezoneShort } from "@/lib/format";
import { requirePermission } from "@/server/context";
import { facilityOverview } from "@/server/overview";
import { weekAtAGlance } from "@/server/reports";
import { can, hasOrgWide } from "@/server/rbac/access";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const n = (v: number) => v.toLocaleString("en-US");

export default async function OverviewPage() {
  const actor = await requirePermission("facilities.view");
  const db = await getDb();
  const [{ facilities, totals }, week] = await Promise.all([facilityOverview(db, actor), can(actor, "reports.view") ? weekAtAGlance(db, actor) : Promise.resolve(null)]);
  const corporate = hasOrgWide(actor, "facilities.view");

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}
        title={corporate ? "All facilities" : facilities.length === 1 ? facilities[0].name : "Your facilities"}
        subtitle="Staffing at a glance. Budget figures come from staffing budgets; actual hours come from timekeeping."
        action={
          hasOrgWide(actor, "facilities.manage") ? (
            <Button asChild>
              <Link href="/facilities/new">Add facility</Link>
            </Button>
          ) : undefined
        }
      />

      {totals && (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Facilities" value={totals.facilities} />
          <Stat label="Active staff" value={n(totals.activeStaff)} hint={`${n(totals.prnStaff)} PRN · ${n(totals.poolEmployees)} in regional pool`} />
          <Stat label="Budgeted hours / week" value={n(totals.budgetedWeeklyHours)} hint="Budget" />
          <Stat label="Actual hours, last 7 days" value={n(totals.actualHoursLast7)} hint="Actual · from timekeeping" />
        </div>
      )}

      {week && (
        <Link href="/reports?preset=this_week" className="group mb-8 block rounded-2xl border border-black/[0.04] bg-surface p-5 shadow-card transition-shadow hover:shadow-pop">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">This week</div>
            <span className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">
              Reports <ArrowUpRight className="size-4" />
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-[12px] text-faint">Openings filled</dt>
              <dd className="tabular mt-0.5 text-[22px] font-semibold">{week.totals.fillRate === null ? "—" : `${week.totals.fillRate}%`}</dd>
              <dd className="text-[12px] text-muted">
                {n(week.totals.requiredSlots - week.totals.filledSlots)} still open
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Scheduled vs budget</dt>
              <dd className="tabular mt-0.5 text-[22px] font-semibold">{week.totals.scheduledVsBudget === null ? "—" : `${week.totals.scheduledVsBudget}%`}</dd>
              <dd className="text-[12px] text-muted">
                {n(week.totals.scheduledHours)} of {n(week.totals.budgetHoursScheduledFacilities)} h{week.totals.facilitiesScheduled < week.totals.facilitiesTotal ? ` · ${week.totals.facilitiesScheduled} of ${week.totals.facilitiesTotal} facilities scheduled` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Projected overtime</dt>
              <dd className="tabular mt-0.5 text-[22px] font-semibold">{n(Math.round(week.totals.overtimeHours))} h</dd>
              <dd className="text-[12px] text-muted">{week.totals.overtimePeople} people · estimate</dd>
            </div>
            <div>
              <dt className="text-[12px] text-faint">Callouts covered</dt>
              <dd className="tabular mt-0.5 text-[22px] font-semibold">{week.totals.callouts ? `${week.totals.calloutsCovered}/${week.totals.callouts}` : "—"}</dd>
              <dd className="text-[12px] text-muted">{week.totals.callouts ? "this week" : "none this week"}</dd>
            </div>
          </dl>
        </Link>
      )}

      {facilities.length === 0 ? (
        <EmptyState icon={<Building2 />} title="No facilities yet" description="Add your first facility to start configuring departments, shifts and staffing budgets." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {facilities.map((f) => {
            const ratio = f.budgetedWeeklyHours ? f.actualHoursLast7 / f.budgetedWeeklyHours : null;
            return (
              <Link key={f.id} href={`/facilities/${f.id}`} className="group rounded-2xl border border-black/[0.04] bg-surface p-5 shadow-card transition-shadow hover:shadow-pop">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[17px] font-semibold tracking-tight">{f.name}</div>
                    <div className="mt-0.5 text-[13px] text-muted">
                      {[f.city, f.state].filter(Boolean).join(", ")} · {timezoneShort(f.timezone)}
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-faint transition-colors group-hover:text-accent" />
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-3">
                  <div>
                    <dt className="text-[12px] text-faint">Active staff</dt>
                    <dd className="tabular mt-0.5 text-[20px] font-semibold">{f.activeStaff}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-faint">Budget hrs/wk</dt>
                    <dd className="tabular mt-0.5 text-[20px] font-semibold">{n(f.budgetedWeeklyHours)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-faint">Actual, 7 days</dt>
                    <dd className="tabular mt-0.5 text-[20px] font-semibold">{f.hasTimekeeping ? n(f.actualHoursLast7) : "—"}</dd>
                  </div>
                </dl>
                {ratio !== null && f.hasTimekeeping && (
                  <div className="mt-4">
                    <div className="h-1.5 overflow-hidden rounded-full bg-fill">
                      <div className={`h-full rounded-full ${ratio > 1.05 ? "bg-caution" : "bg-accent"}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
                    </div>
                    <div className="mt-1.5 text-[12px] text-muted">{Math.round(ratio * 100)}% of weekly budget worked (actual vs budget)</div>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {f.prnStaff > 0 && <Badge>{f.prnStaff} PRN</Badge>}
                  {f.poolAuthorized > 0 && <Badge tone="accent">{f.poolAuthorized} pool eligible</Badge>}
                  {f.onLeave > 0 && <Badge tone="caution">{f.onLeave} on leave</Badge>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <p className="mt-8 text-[13px] text-faint">Coverage, open shifts and projected overtime appear here once schedules are built (next release).</p>
    </>
  );
}
