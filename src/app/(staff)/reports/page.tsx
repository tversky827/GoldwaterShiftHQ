import { BarChart3 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/context";
import { can } from "@/server/rbac/access";
import { laborReport, type PeriodPreset } from "@/server/reports";
import { ExportMenu, ReportFilters } from "./filters";
import { HoursChart } from "./hours-chart";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const n = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const p = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
const dur = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${n(h, 1)} h` : `${n(h / 24, 1)} days`);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string; facilityId?: string }> }) {
  const actor = await requirePermission("reports.view");
  const sp = await searchParams;
  const preset = (["this_week", "last_week", "last_4_weeks", "last_3_months", "custom"].includes(sp.preset ?? "") ? sp.preset : "last_week") as PeriodPreset;
  let r;
  try {
    r = await laborReport(await getDb(), actor, { preset, from: sp.from, to: sp.to, facilityId: sp.facilityId || undefined });
  } catch (e) {
    return <EmptyState icon={<BarChart3 />} title="Couldn't build this report" description={(e as Error).message} />;
  }
  const t = r.totals;
  const q = new URLSearchParams({ preset: r.period.preset, ...(r.period.preset === "custom" ? { from: r.period.from, to: r.period.to } : {}), ...(sp.facilityId ? { facilityId: sp.facilityId } : {}) }).toString();
  const canExport = can(actor, "reports.export");
  const variance = (a: number | null) => (a === null ? "" : a < 90 ? "text-caution" : a > 110 ? "text-critical" : "");

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={r.period.label} title="Reports" subtitle="Budget, schedule and timekeeping side by side, with overtime and how quickly shifts get covered." action={canExport ? <ExportMenu query={q} /> : undefined} />
      <ReportFilters preset={r.period.preset} from={r.period.from} to={r.period.to} facilityId={sp.facilityId ?? ""} facilities={r.scope.facilities} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Fill rate" value={p(t.fillRate)} hint={`${n(t.filledSlots)} of ${n(t.requiredSlots)} openings`} />
        <Stat label="Scheduled vs budget" value={p(t.scheduledVsBudget)} hint={t.facilitiesScheduled < t.facilitiesTotal ? `${n(t.scheduledHours)} of ${n(t.budgetHoursScheduledFacilities)} h · ${t.facilitiesScheduled} of ${t.facilitiesTotal} facilities scheduled` : `${n(t.scheduledHours)} of ${n(t.budgetHours)} h`} />
        <Stat label="Clocked vs scheduled" value={r.timekeepingAvailable ? p(t.clockedVsScheduled) : "—"} hint={r.timekeepingAvailable ? `${n(t.clockedHoursScheduledFacilities)} h clocked where scheduled` : "No timekeeping for this period"} />
        <Stat label="Overtime (estimate)" value={`${n(t.overtimeHours, 1)} h`} tone={t.overtimeHours ? "caution" : undefined} hint={`${t.overtimePeople} ${t.overtimePeople === 1 ? "person" : "people"}${r.rulesConfirmed ? "" : " · example rule"}`} />
        <Stat label="Time to fill (median)" value={dur(t.medianHoursToFill)} hint={`${n(t.listingsFilled)} of ${n(t.listingsPublished)} open shifts filled`} />
        <Stat label="Callouts covered" value={t.callouts ? `${t.calloutsCovered}/${t.callouts}` : "—"} hint={t.medianMinutesToCover !== null ? `Median ${dur(t.medianMinutesToCover / 60)} to cover` : "No callouts"} />
      </div>

      <Card>
        <CardHeader title="Hours by facility" description="Budget from staffing budgets, scheduled from assignments, clocked from timekeeping." />
        {r.facilities.length ? <HoursChart rows={r.facilities.map((f) => ({ code: f.code, name: f.name, budget: f.budgetHours, scheduled: f.scheduledHours, clocked: f.clockedHours }))} showClocked={r.timekeepingAvailable} /> : <EmptyState title="No facilities in scope" />}
        <Table>
          <thead>
            <tr>
              <Th>Facility</Th>
              <Th className="text-right">Budget h</Th>
              <Th className="text-right">Scheduled h</Th>
              <Th className="text-right">vs budget</Th>
              <Th className="text-right">Clocked h</Th>
              <Th className="text-right">Fill rate</Th>
              <Th className="text-right">Overtime h</Th>
              <Th className="text-right">Pool h</Th>
              <Th className="text-right">Time to fill</Th>
              <Th className="text-right">Callouts</Th>
            </tr>
          </thead>
          <tbody>
            {r.facilities.map((f) => (
              <tr key={f.id}>
                <Td>
                  <span className="font-medium">{f.code}</span> <span className="text-[13px] text-muted">{f.name}</span>
                </Td>
                <Td className="tabular text-right">{n(f.budgetHours)}</Td>
                <Td className="tabular text-right">{n(f.scheduledHours)}</Td>
                <Td className={cn("tabular text-right", variance(f.scheduledVsBudget))}>{f.requiredSlots ? p(f.scheduledVsBudget) : <span className="text-[12px] text-faint">No schedule</span>}</Td>
                <Td className="tabular text-right">{r.timekeepingAvailable ? n(f.clockedHours) : "—"}</Td>
                <Td className="tabular text-right">{p(f.fillRate)}</Td>
                <Td className="tabular text-right">{f.overtimeHours ? n(f.overtimeHours, 1) : "—"}</Td>
                <Td className="tabular text-right">{f.poolHours ? n(f.poolHours) : "—"}</Td>
                <Td className="tabular text-right">{dur(f.medianHoursToFill)}</Td>
                <Td className="tabular text-right">{f.callouts ? `${f.calloutsCovered}/${f.callouts}` : "—"}</Td>
              </tr>
            ))}
            {r.facilities.length > 1 && (
              <tr className="font-medium">
                <Td>All selected facilities</Td>
                <Td className="tabular text-right">{n(t.budgetHours)}</Td>
                <Td className="tabular text-right">{n(t.scheduledHours)}</Td>
                <Td className={cn("tabular text-right", variance(t.scheduledVsBudget))}>{p(t.scheduledVsBudget)}</Td>
                <Td className="tabular text-right">{r.timekeepingAvailable ? n(t.clockedHours) : "—"}</Td>
                <Td className="tabular text-right">{p(t.fillRate)}</Td>
                <Td className="tabular text-right">{t.overtimeHours ? n(t.overtimeHours, 1) : "—"}</Td>
                <Td className="tabular text-right">{t.poolHours ? n(t.poolHours) : "—"}</Td>
                <Td className="tabular text-right">{dur(t.medianHoursToFill)}</Td>
                <Td className="tabular text-right">{t.callouts ? `${t.calloutsCovered}/${t.callouts}` : "—"}</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Overtime" description={`People over ${r.overtimeThreshold ?? "the threshold"} hours in a workweek, counting every facility. An estimate: payroll remains the official record.`} action={!r.rulesConfirmed ? <Badge tone="caution">Example rule, not confirmed</Badge> : undefined} />
        {r.overtime.length === 0 ? (
          <CardBody className="text-[14px] text-muted">No one went over the threshold in this period.</CardBody>
        ) : (
          <Table className="mt-3">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Workweek starting</Th>
                <Th className="text-right">Hours (all facilities)</Th>
                <Th className="text-right">Overtime h</Th>
                <Th>Facilities</Th>
              </tr>
            </thead>
            <tbody>
              {r.overtime.slice(0, 15).map((o) => (
                <tr key={`${o.employeeId}-${o.weekStart}`}>
                  <Td className="font-medium">{o.name}</Td>
                  <Td className="tabular">{o.weekStart}</Td>
                  <Td className="tabular text-right">{n(o.hours, 1)}</Td>
                  <Td className="tabular text-right font-medium">{n(o.overtime, 1)}</Td>
                  <Td className="text-[13px] text-ink-2">{o.facilities}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {r.overtime.length > 15 && <CardBody className="text-[13px] text-muted">{r.overtime.length - 15} more in the Excel export.</CardBody>}
      </Card>

      <p className="text-[12px] leading-relaxed text-faint">
        How these are measured: budget hours come from each facility's staffing budget for every day in the period; scheduled hours count people assigned to shifts; clocked hours come from timekeeping. Fill rate is filled openings ÷ required openings. Time to fill runs from when an open shift was published to when a pick-up was approved. Every export is recorded in the audit log.
      </p>
    </div>
  );
}
