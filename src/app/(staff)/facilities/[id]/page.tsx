import { Clock, Layers, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, KeyValue, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { formatTime, timezoneShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/context";
import { getFacility, getStaffingBudgets } from "@/server/facilities";
import { can } from "@/server/rbac/access";
import { AddDepartment, AddShift, AddUnit, PositionsForm, ToggleDepartment, ToggleShift } from "./dialogs";
import { NewBudgetDialog } from "./budgets/[templateId]/budget-dialogs";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "structure", label: "Departments & units" },
  { key: "shifts", label: "Shifts" },
  { key: "budget", label: "Staffing budget" },
  { key: "classifications", label: "Job classifications" },
] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  void params;
  return { title: "Facility" };
}

export default async function FacilityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const actor = await requirePermission("facilities.view", { facilityId: id });
  const db = await getDb();
  const data = await getFacility(db, actor, id);
  const f = data.facility;
  const manage = can(actor, "facilities.manage", { facilityId: id });
  const budgets = tab === "budget" || tab === "overview" ? (can(actor, "budgets.view", { facilityId: id }) ? await getStaffingBudgets(db, actor, id) : []) : [];
  const enabledPositions = data.positions.filter((p) => p.enabled);
  const activeShifts = data.shiftTemplates.filter((s) => s.isActive);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/facilities" className="hover:text-accent">
            Facilities
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {f.name}
            {!f.isActive && <Badge>Inactive</Badge>}
          </span>
        }
        subtitle={`${[f.city, f.state].filter(Boolean).join(", ")}${f.city ? " · " : ""}${timezoneShort(f.timezone)} · ${f.code}`}
        action={
          <>
            {can(actor, "employees.view", { facilityId: id }) && (
              <Button asChild variant="secondary">
                <Link href={`/employees?facilityId=${id}`}>
                  <Users /> Employees
                </Link>
              </Button>
            )}
            {manage && (
              <Button asChild>
                <Link href={`/facilities/${id}/edit`}>Edit details</Link>
              </Button>
            )}
          </>
        }
      />

      <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto" aria-label="Facility sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/facilities/${id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors", tab === t.key ? "bg-ink text-white" : "text-ink-2 hover:bg-fill")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Details" />
            <CardBody>
              <KeyValue
                items={[
                  { label: "Address", value: [f.addressLine1, f.addressLine2, [f.city, f.state, f.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—" },
                  { label: "Time zone", value: `${f.timezone} (${timezoneShort(f.timezone)})` },
                  { label: "Phone", value: f.phone },
                  { label: "Licensed beds", value: f.licensedBeds },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Configuration" />
            <CardBody className="space-y-3 text-[15px]">
              <SetupRow href={`/facilities/${id}?tab=structure`} label="Departments" value={data.departments.filter((d) => d.isActive).length} />
              <SetupRow href={`/facilities/${id}?tab=structure`} label="Units" value={data.departments.reduce((n, d) => n + d.units.length, 0)} />
              <SetupRow href={`/facilities/${id}?tab=shifts`} label="Shifts" value={activeShifts.length} />
              <SetupRow href={`/facilities/${id}?tab=classifications`} label="Job classifications" value={enabledPositions.length} />
              <SetupRow href={`/facilities/${id}?tab=budget`} label="Budgeted hours / week" value={budgets.filter((b) => b.template.isActive).reduce((n, b) => n + b.weeklyHours, 0).toLocaleString()} />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "structure" && (
        <Card>
          <CardHeader title="Departments & units" description="Units are optional. Use them when staffing differs by wing or neighborhood." action={manage && <AddDepartment facilityId={id} />} />
          <CardBody className="pt-3">
            {data.departments.length === 0 ? (
              <EmptyState icon={<Layers />} title="No departments yet" description="Add Nursing, Dietary, Housekeeping, or whatever your facility uses." />
            ) : (
              <ul className="divide-y divide-line">
                {data.departments.map((d) => (
                  <li key={d.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={cn("text-[15px] font-medium", !d.isActive && "text-faint line-through")}>{d.name}</span>
                      {d.isClinical && <Badge tone="accent">Clinical</Badge>}
                      {!d.isActive && <Badge>Inactive</Badge>}
                      <div className="ml-auto flex flex-wrap items-center gap-1">
                        {manage && d.isActive && <AddUnit facilityId={id} departmentId={d.id} departmentName={d.name} />}
                        {manage && <ToggleDepartment facilityId={id} departmentId={d.id} active={d.isActive} />}
                      </div>
                    </div>
                    {d.units.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.units.map((u) => (
                          <Badge key={u.id}>{u.name}</Badge>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "shifts" && (
        <Card>
          <CardHeader title="Shifts" description={`Times shown in ${timezoneShort(f.timezone)}, the facility’s local time.`} action={manage && <AddShift facilityId={id} />} />
          <div className="pt-3">
            {data.shiftTemplates.length === 0 ? (
              <EmptyState icon={<Clock />} title="No shifts yet" description="Add Day, Evening and Night (or 12-hour) shifts to build staffing budgets." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Shift</Th>
                    <Th>Hours</Th>
                    <Th className="text-right">Paid hours</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.shiftTemplates.map((s) => (
                    <tr key={s.id} className={cn(!s.isActive && "text-faint")}>
                      <Td>
                        <span className="font-medium">{s.name}</span> <span className="text-muted">· {s.code}</span>
                      </Td>
                      <Td className="tabular">
                        {formatTime(s.startTime)} – {formatTime(s.endTime)}
                        {s.endTime <= s.startTime && <span className="ml-2 text-[12px] text-muted">overnight</span>}
                      </Td>
                      <Td className="tabular text-right">{s.paidHours.toFixed(2).replace(/\.00$/, "")}</Td>
                      <Td className="text-right">{manage && <ToggleShift facilityId={id} templateId={s.id} active={s.isActive} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      )}

      {tab === "budget" && (
        <div className="space-y-4">
          {can(actor, "budgets.manage", { facilityId: id }) && (
            <div className="flex justify-end">
              <NewBudgetDialog facilityId={id} departments={data.departments.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name }))} />
            </div>
          )}
          {budgets.length === 0 ? (
            <Card>
              <EmptyState icon={<Layers />} title="No staffing budget yet" description="Staffing budgets set how many of each position you need per shift and day. Schedules are generated from them." />
            </Card>
          ) : (
            budgets.map((b) => (
              <Card key={b.template.id}>
                <CardHeader
                  title={b.template.name}
                  description={`${b.departmentName ?? "All departments"} · effective ${b.template.effectiveFrom}${b.template.effectiveTo ? ` to ${b.template.effectiveTo}` : ""} · ${b.weeklyHours.toLocaleString()} budgeted hours / week`}
                  action={
                    <span className="flex items-center gap-2">
                      <Badge tone={b.template.isActive ? "positive" : "neutral"}>{b.template.isActive ? "Active" : "Inactive"}</Badge>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/facilities/${id}/budgets/${b.template.id}`}>{can(actor, "budgets.manage", { facilityId: id }) ? "Edit" : "View"}</Link>
                      </Button>
                    </span>
                  }
                />
                <div className="pt-3">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Shift · position</Th>
                        {DAYS.map((d) => (
                          <Th key={d} className="text-center">
                            {d}
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.shifts.map((s) =>
                        s.rows.map((r, i) => (
                          <tr key={`${s.code}-${r.code}`}>
                            <Td>
                              {i === 0 && <div className="text-[12px] font-medium uppercase tracking-wide text-faint">{s.name}</div>}
                              <span className="font-medium">{r.code}</span> <span className="text-muted">{r.name}</span>
                            </Td>
                            {r.days.map((n, d) => (
                              <Td key={d} className="tabular text-center text-[15px]">
                                {n || <span className="text-faint">–</span>}
                              </Td>
                            ))}
                          </tr>
                        )),
                      )}
                    </tbody>
                  </Table>
                </div>
              </Card>
            ))
          )}
          <p className="text-[13px] text-faint">Budgets describe need only. Changes apply to schedules when you click “Sync with budget” on the schedule.</p>
        </div>
      )}

      {tab === "classifications" && (
        <Card>
          <CardHeader title="Job classifications used here" description="Choose which organization-wide classifications this facility schedules. Manage the list itself in Settings → Classifications." />
          <CardBody>
            {manage ? (
              <PositionsForm facilityId={id} positions={data.positions} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {enabledPositions.map((p) => (
                  <Badge key={p.id}>{p.name}</Badge>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </>
  );
}

function SetupRow({ href, label, value }: { href: string; label: string; value: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-lg py-1 hover:text-accent">
      <span className="text-ink-2">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </Link>
  );
}
