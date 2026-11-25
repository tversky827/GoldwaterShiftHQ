import { AlertTriangle, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { EMPLOYMENT_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireStaff } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { canSeePool, poolDashboard } from "@/server/pool";
import { AddToPoolDialog, FindStaffDialog } from "./pool-dialogs";

export const metadata = { title: "Regional pool" };
export const dynamic = "force-dynamic";

export default async function PoolPage({ searchParams }: { searchParams: Promise<{ week?: string; all?: string }> }) {
  const actor = await requireStaff();
  if (!canSeePool(actor)) redirect("/forbidden");
  const { week, all } = await searchParams;
  const LIMIT = all ? 200 : 15;
  const offset = week === "next" ? 1 : 0;
  const db = await getDb();
  const d = await poolDashboard(db, actor, { weekOffset: offset });
  const facilities = d.byFacility.length ? d.byFacility : [];
  const dayFmt = (tz: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const timeFmt = (tz: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const weekLabel = `${new Date(`${d.week.startDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${new Date(`${d.week.endDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  const allFacilities = d.canManage ? (await listFacilities(db, actor)).filter((f) => f.isActive).map((f) => ({ id: f.id, name: f.name })) : [];

  return (
    <div className="space-y-8">
      <PageHeader title="Regional pool" subtitle="Float staff across every facility: where help is needed, who can go, and their hours everywhere." action={d.canManage ? <AddToPoolDialog facilities={allFacilities} /> : undefined} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Pool staff" value={d.totals.members} hint={d.totals.onLeave ? `${d.totals.onLeave} on leave` : "Active"} />
        <Stat label="Open slots, next 7 days" value={d.totals.openSlots} tone={d.totals.openSlots ? "caution" : undefined} hint="Positions the pool covers" />
        <Stat label="Hours available this week" value={d.totals.capacityHours} hint={`Before ${d.overtimeThreshold}-hour overtime or personal limits`} />
        <Stat label="Near or over overtime" value={d.totals.nearOvertime} tone={d.totals.nearOvertime ? "critical" : undefined} hint={d.rulesConfirmed ? undefined : "Overtime rule not confirmed yet"} />
      </div>

      <Card>
        <CardHeader title="Where help is needed" description="Unfilled shifts in the next 7 days that pool staff are qualified for." />
        {d.needs.length === 0 ? (
          <EmptyState icon={<Users />} title="Every shift is covered" description="No unfilled shifts in the next 7 days for positions the pool covers." />
        ) : (
          <>
            {facilities.some((f) => f.openSlots) && (
              <div className="flex flex-wrap gap-2 px-6 pt-4">
                {facilities
                  .filter((f) => f.openSlots)
                  .map((f) => (
                    <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-[13px]">
                      <span className="font-semibold">{f.code}</span>
                      <span className="text-ink-2">{f.openSlots} open</span>
                      <span className="text-faint">· {f.poolAuthorized} pool authorized</span>
                    </span>
                  ))}
              </div>
            )}
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th>Shift</Th>
                  <Th>Facility</Th>
                  <Th>Position</Th>
                  <Th>Open</Th>
                  <Th>Pool staff who could go</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {d.needs.slice(0, LIMIT).map((n) => (
                  <tr key={n.id}>
                    <Td>
                      <div className="font-medium">{dayFmt(n.facilityTimezone).format(n.startsAt)}</div>
                      <div className="tabular text-[13px] text-muted">
                        {timeFmt(n.facilityTimezone).format(n.startsAt)} – {timeFmt(n.facilityTimezone).format(n.endsAt)}
                      </div>
                    </Td>
                    <Td>
                      <span className="font-medium" title={n.facilityName}>
                        {n.facilityCode}
                      </span>
                    </Td>
                    <Td>
                      {n.positionCode}
                      {n.listed && <Badge className="ml-2">Posted</Badge>}
                    </Td>
                    <Td className="tabular">{n.open}</Td>
                    <Td className={cn("tabular", !n.eligiblePool && "text-faint")}>{n.eligiblePool ? `${n.eligiblePool} qualified & authorized` : "None authorized"}</Td>
                    <Td className="text-right">{n.eligiblePool > 0 && <FindStaffDialog shiftId={n.id} canPlace={n.canPlace} title={`${n.positionCode} at ${n.facilityName}`} subtitle={`${dayFmt(n.facilityTimezone).format(n.startsAt)}, ${timeFmt(n.facilityTimezone).format(n.startsAt)} – ${timeFmt(n.facilityTimezone).format(n.endsAt)}. Ranked by the rules engine.`} />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {d.needs.length > LIMIT && (
              <div className="px-6 py-3 text-[14px]">
                <Link href={`/pool?all=1${offset ? "&week=next" : ""}`} className="font-medium text-accent">
                  Show all {d.needs.length} shifts
                </Link>
              </div>
            )}
          </>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Pool staff"
          description={`Hours across all facilities, workweek ${weekLabel}.`}
          action={
            <div className="inline-flex rounded-full bg-fill p-1 text-[13px]">
              {[
                { k: "", l: "This week" },
                { k: "next", l: "Next week" },
              ].map((t) => (
                <Link key={t.l} href={`/pool${t.k ? `?week=${t.k}` : ""}`} className={cn("rounded-full px-3 py-1", (t.k === "next") === (offset === 1) ? "bg-surface font-medium shadow-card" : "text-ink-2")}>
                  {t.l}
                </Link>
              ))}
            </div>
          }
        />
        {d.members.length === 0 ? (
          <EmptyState icon={<Users />} title="No pool staff yet" description={d.canManage ? "Use “Add to pool” to classify float staff and authorize their facilities." : "Pool staff authorized at your facilities will appear here."} />
        ) : (
          <Table className="mt-3">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Authorized at</Th>
                <Th>Hours this week</Th>
                <Th>Next shift</Th>
              </tr>
            </thead>
            <tbody>
              {d.members.map((m) => {
                const pct = Math.min(100, (m.hours.projected / Math.max(1, m.limit)) * 100);
                const over = m.hours.projected > m.limit;
                const near = !over && m.hours.projected >= m.limit - 4;
                return (
                  <tr key={m.id}>
                    <Td>
                      <Link href={`/employees/${m.id}`} className="font-medium hover:text-accent">
                        {m.name}
                      </Link>
                      <div className="text-[13px] text-muted">
                        {m.primaryPosition ?? "—"} · {EMPLOYMENT_TYPE_LABEL[m.employmentType as keyof typeof EMPLOYMENT_TYPE_LABEL] ?? m.employmentType}
                        {m.status === "leave" && " · On leave"}
                      </div>
                      {m.credentialAlerts.length > 0 && (
                        <div className="mt-1 flex items-center gap-1 text-[12px] text-caution">
                          <AlertTriangle className="size-3.5" /> {m.credentialAlerts.join(" · ")}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {m.facilities.length ? m.facilities.map((f) => <Badge key={f.id} title={f.name}>{f.code}</Badge>) : <span className="text-[13px] text-faint">None yet</span>}
                      </div>
                    </Td>
                    <Td className="min-w-56">
                      <div className="flex items-baseline justify-between text-[13px]">
                        <span className={cn("tabular font-medium", over && "text-critical", near && "text-caution")}>
                          {m.hours.projected} / {m.limit} h
                        </span>
                        <span className="text-faint">{m.remaining} h left</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill">
                        <div className={cn("h-full rounded-full", over ? "bg-critical" : near ? "bg-caution" : "bg-accent")} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[12px] text-muted">
                        {m.hours.actual > 0 && `Clocked ${m.hours.actual} h · `}
                        {m.hours.scheduled > 0 ? `Scheduled ${m.hours.scheduled} h` : "Nothing scheduled"}
                        {m.hours.byFacility.length > 0 && ` · ${m.hours.byFacility.map((b) => b.code).join(", ")}`}
                        {m.limitSource === "preference" && " · personal limit"}
                      </div>
                    </Td>
                    <Td className="text-[13px]">{m.nextShift ? `${dayFmt(m.nextShift.facilityTimezone).format(m.nextShift.startsAt)}, ${timeFmt(m.nextShift.facilityTimezone).format(m.nextShift.startsAt)} · ${m.nextShift.facilityName.split(" ")[0]} ${m.nextShift.positionCode}` : <span className="text-faint">None scheduled</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <CardBody className="px-1 py-0 text-[12px] text-faint">Hours: actual clocked hours for past days, scheduled hours for today and later, at every facility. Overtime threshold {d.overtimeThreshold} h per week{d.rulesConfirmed ? "" : " (example value; confirm in Settings → Rules)"}.</CardBody>
    </div>
  );
}
