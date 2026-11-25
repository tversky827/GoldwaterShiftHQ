import { CalendarDays } from "lucide-react";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { addDaysStr } from "@/lib/tz";
import { requirePermission } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { can } from "@/server/rbac/access";
import { pendingApprovals } from "@/server/scheduling/assignments";
import { effectiveRules } from "@/server/scheduling/rules";
import { normalizeWeek, schedulingRoster, weekView } from "@/server/scheduling/schedules";
import { ScheduleBoard } from "./board";

export const metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ facilityId?: string; week?: string; dept?: string; pos?: string }> }) {
  const actor = await requirePermission("schedules.view");
  const sp = await searchParams;
  const db = await getDb();
  const facilities = (await listFacilities(db, actor)).filter((f) => f.isActive && can(actor, "schedules.view", { facilityId: f.id }));
  if (!facilities.length) return <EmptyState icon={<CalendarDays />} title="No facilities to schedule" description="You don't have schedule access to any facility yet." />;
  const facility = facilities.find((f) => f.id === sp.facilityId) ?? facilities[0];
  const week = normalizeWeek(sp.week, facility.timezone);
  if (sp.facilityId !== facility.id || sp.week !== week) {
    const q = new URLSearchParams({ facilityId: facility.id, week, ...(sp.dept ? { dept: sp.dept } : {}), ...(sp.pos ? { pos: sp.pos } : {}) });
    redirect(`/schedule?${q}`);
  }
  const [view, roster, approvals, rules] = await Promise.all([
    weekView(db, actor, facility.id, week, { departmentId: sp.dept, positionId: sp.pos }),
    schedulingRoster(db, actor, facility.id, week),
    pendingApprovals(db, actor, facility.id),
    effectiveRules(db, actor.organizationId, facility.id),
  ]);
  const manage = can(actor, "schedules.manage", { facilityId: facility.id });

  return (
    <ScheduleBoard
      facilities={facilities.map((f) => ({ id: f.id, name: f.name }))}
      facility={{ id: facility.id, name: facility.name, timezone: facility.timezone }}
      week={week}
      prevWeek={addDaysStr(week, -7)}
      nextWeek={addDaysStr(week, 7)}
      filters={{ dept: sp.dept ?? "", pos: sp.pos ?? "" }}
      departments={view.departments.map((d) => ({ id: d.id, name: d.name }))}
      positions={view.positions.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
      templates={view.templates.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, code: t.code }))}
      schedule={view.schedule ? { id: view.schedule.id, status: view.schedule.status, publishedAt: view.schedule.publishedAt?.toISOString() ?? null } : null}
      days={view.days}
      rows={view.rows.map((r) => ({
        key: r.key,
        shiftCode: r.shiftTemplate?.code ?? "—",
        shiftName: r.shiftTemplate?.name ?? "Shift",
        start: r.shiftTemplate?.startTime ?? "",
        end: r.shiftTemplate?.endTime ?? "",
        positionId: r.position.id,
        positionCode: r.position.code,
        positionName: r.position.name,
        unitName: r.unitName,
        cells: r.cells,
      }))}
      totals={view.totals}
      roster={roster}
      approvals={approvals.map((a) => ({ id: a.request.id, employee: `${a.employeeFirst} ${a.employeeLast}`, startsAt: a.startsAt.toISOString(), position: a.positionCode, requestedBy: a.requestedBy ?? "", reasons: ((a.request.payload as { evaluation?: { outcome: string; message: string }[] } | null)?.evaluation ?? []).filter((e) => e.outcome !== "warning").map((e) => e.message) }))}
      permissions={{ manage, publish: can(actor, "schedules.publish", { facilityId: facility.id }), approve: can(actor, "assignments.approve", { facilityId: facility.id }) }}
      rulesConfirmed={rules.confirmed}
    />
  );
}
