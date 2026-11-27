import { AlertTriangle, CheckCircle2, CircleSlash, Loader2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, Input, Stat, Table, Td, Th, type Tone } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { departments, positions } from "@/db/schema";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireStaff } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { integrationOverview, listMappings, reconciliation, type DisplayStatus } from "@/server/integrations";
import { hasOrgWide } from "@/server/rbac/access";
import { ConnectionButtons, MapValueForm } from "./integration-controls";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const STATUS: Record<DisplayStatus, { label: string; tone: Tone; icon: React.ReactNode }> = {
  connected: { label: "Connected", tone: "positive", icon: <CheckCircle2 className="size-3.5" /> },
  needs_attention: { label: "Needs attention", tone: "caution", icon: <AlertTriangle className="size-3.5" /> },
  disconnected: { label: "Disconnected", tone: "critical", icon: <CircleSlash className="size-3.5" /> },
  syncing: { label: "Synchronizing", tone: "accent", icon: <Loader2 className="size-3.5 animate-spin" /> },
};

const TABS = [
  { key: "status", label: "Status" },
  { key: "mappings", label: "Mappings" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "history", label: "Sync history" },
];

function ModeBadge({ mode }: { mode: string }) {
  if (mode === "demo") return <Badge tone="caution">Demonstration data</Badge>;
  if (mode === "production") return <Badge tone="critical">Production · real data</Badge>;
  return <Badge tone="accent">{mode === "sandbox" ? "Sandbox" : mode === "soap" ? "Web services" : mode === "file" ? "Export files" : mode}</Badge>;
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; msg?: string; ok?: string }> }) {
  const actor = await requireStaff();
  if (!hasOrgWide(actor, "integrations.view")) redirect("/forbidden");
  const { tab = "status", msg, ok } = await searchParams;
  const db = await getDb();
  const o = await integrationOverview(db, actor);
  const manage = hasOrgWide(actor, "integrations.manage");
  const unmappedCount = Object.values(o.unmapped).reduce((n, m) => n + Object.keys(m ?? {}).length, 0);

  return (
    <>
      {msg && <div className={cn("mb-6 rounded-xl px-4 py-3 text-[14px]", ok === "1" ? "bg-positive-soft text-positive" : "bg-critical-soft text-critical")}>{msg}</div>}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Employees from Paycor" value={o.counts.employeesImported.toLocaleString()} />
        <Stat label="Attendance records" value={o.counts.attendanceRecords.toLocaleString()} hint="From Attendance on Demand" />
        <Stat label="Unmatched timekeeping IDs" value={o.counts.unmatchedTimekeepingEmployees} tone={o.counts.unmatchedTimekeepingEmployees ? "caution" : undefined} />
        <Stat label="Syncs needing attention" value={o.counts.pendingErrors} tone={o.counts.pendingErrors ? "caution" : undefined} />
      </div>

      <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto" aria-label="Integration sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/settings/integrations?tab=${t.key}`} className={cn("whitespace-nowrap rounded-full px-4 py-1.5 text-[14px]", tab === t.key ? "bg-fill font-medium text-ink" : "text-ink-2 hover:bg-fill/60")}>
            {t.label}
            {t.key === "mappings" && unmappedCount > 0 && <span className="ml-1.5 rounded-full bg-caution px-1.5 text-[11px] text-white">{unmappedCount}</span>}
          </Link>
        ))}
      </nav>

      {tab === "status" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { s: o.paycor, title: "Paycor", subtitle: "Employees, status, positions, home facility. System of record for employee data." },
            { s: o.aod, title: "Attendance on Demand", subtitle: "Clock punches and hours worked. Read-only." },
          ].map(({ s, title, subtitle }) => {
            const st = STATUS[s.status];
            return (
              <Card key={s.provider}>
                <CardHeader
                  title={title}
                  description={subtitle}
                  action={
                    <Badge tone={st.tone} className="text-[13px]">
                      {st.icon} {st.label}
                    </Badge>
                  }
                />
                <CardBody className="space-y-5">
                  <p className={cn("text-[14px]", s.status === "connected" ? "text-muted" : "text-ink-2")}>{s.reason}</p>
                  <dl className="grid grid-cols-2 gap-4 text-[14px]">
                    <div>
                      <dt className="text-[12px] text-faint">Mode</dt>
                      <dd className="mt-1">
                        <ModeBadge mode={s.mode} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-faint">Last successful sync</dt>
                      <dd className="mt-1">{s.lastSuccessAt ? `${relativeTime(s.lastSuccessAt)}` : "Never"}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-faint">Last failure</dt>
                      <dd className="mt-1">{s.lastFailureAt ? relativeTime(s.lastFailureAt) : "None"}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-faint">Last connection test</dt>
                      <dd className="mt-1">{s.lastTest?.lastTestAt ? `${s.lastTest.lastTestOk ? "Passed" : "Failed"} ${relativeTime(s.lastTest.lastTestAt)}` : "Not tested"}</dd>
                    </div>
                  </dl>
                  {s.lastFailureMessage && s.status !== "connected" && <div className="rounded-xl bg-caution-soft px-4 py-3 text-[13px] text-caution">{s.lastFailureMessage}</div>}
                  {manage && <ConnectionButtons provider={s.provider} canSync />}

                  {s.provider === "paycor" && o.paycor.mode !== "demo" && manage && (
                    <form method="post" action="/api/integrations/paycor/connect" className="space-y-2 border-t border-line pt-4">
                      <div className="text-[14px] font-medium">Connect a Paycor legal entity</div>
                      <p className="text-[13px] text-muted">A Paycor client administrator approves access once per legal entity.</p>
                      <div className="flex gap-2">
                        <Input name="legalEntityId" inputMode="numeric" pattern="[0-9]+" placeholder="Legal entity ID" required className="max-w-[200px]" aria-label="Legal entity ID" />
                        <Button type="submit">Connect Paycor</Button>
                      </div>
                      <p className="text-[12px] text-faint">
                        Redirect URL to register in Paycor AppCreator: <code className="rounded bg-fill px-1">{o.paycor.redirectUri}</code>
                      </p>
                      {o.paycor.connections.filter((c) => c.legalEntityId).length > 0 && (
                        <ul className="pt-2 text-[13px]">
                          {o.paycor.connections
                            .filter((c) => c.legalEntityId)
                            .map((c) => (
                              <li key={c.id} className="flex justify-between">
                                <span>Legal entity {c.legalEntityId}</span>
                                <span className="text-muted">{c.authorized ? `authorized ${relativeTime(c.authorizedAt)}` : "not authorized"}</span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </form>
                  )}
                  {s.provider === "aod" && o.aod.mode === "file" && manage && (
                    <form method="post" action="/api/integrations/aod/upload" encType="multipart/form-data" className="space-y-2 border-t border-line pt-4">
                      <div className="text-[14px] font-medium">Upload an Attendance on Demand export</div>
                      <div className="flex gap-2">
                        <input type="file" name="file" accept=".csv" required className="text-[13px]" />
                        <Button type="submit" size="sm">
                          Upload
                        </Button>
                      </div>
                    </form>
                  )}
                </CardBody>
              </Card>
            );
          })}
          <p className="text-[13px] text-faint lg:col-span-2">
            Setup guides for both systems are in <code>docs/integrations</code>. The platform only reads from Paycor and Attendance on Demand; it never writes payroll, employee or timecard changes back.
          </p>
        </div>
      )}

      {tab === "mappings" && <MappingsTab db={db} actor={actor} unmapped={o.unmapped} manage={manage} />}
      {tab === "reconciliation" && <ReconciliationTab issues={await reconciliation(db, actor)} />}
      {tab === "history" && (
        <Card>
          <CardHeader title="Sync history" description="Most recent 30 synchronizations." />
          <div className="pt-3">
            {o.history.length === 0 ? (
              <EmptyState title="No synchronizations yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Started</Th>
                    <Th>System</Th>
                    <Th>Trigger</Th>
                    <Th>Result</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">New</Th>
                    <Th className="text-right">Updated</Th>
                    <Th className="text-right">Deactivated</Th>
                  </tr>
                </thead>
                <tbody>
                  {o.history.map((l) => (
                    <tr key={l.id}>
                      <Td className="tabular whitespace-nowrap">{formatDateTime(l.startedAt)}</Td>
                      <Td>{l.provider === "paycor" ? "Paycor" : "AOD"}</Td>
                      <Td className="capitalize text-ink-2">{l.trigger}</Td>
                      <Td>
                        <Badge tone={l.status === "success" ? "positive" : l.status === "failed" ? "critical" : l.status === "partial" ? "caution" : "accent"}>{l.status}</Badge>
                        {l.errorSummary && <div className="mt-1 max-w-md text-[12px] text-muted">{l.errorSummary}</div>}
                      </Td>
                      <Td className="tabular text-right">{l.recordsReceived}</Td>
                      <Td className="tabular text-right">{l.recordsCreated}</Td>
                      <Td className="tabular text-right">{l.recordsUpdated}</Td>
                      <Td className="tabular text-right">{l.recordsDeactivated}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

async function MappingsTab({ db, actor, unmapped, manage }: { db: Awaited<ReturnType<typeof getDb>>; actor: Awaited<ReturnType<typeof requireStaff>>; unmapped: Record<string, Record<string, number>>; manage: boolean }) {
  const [mappings, facs, pos] = await Promise.all([listMappings(db, actor), listFacilities(db, actor), db.select().from(positions).where(eq(positions.organizationId, actor.organizationId)).orderBy(asc(positions.sortOrder))]);
  const depts = facs.length ? await db.select().from(departments).where(inArray(departments.facilityId, facs.map((f) => f.id))) : [];
  const facilityOptions = facs.map((f) => ({ id: f.id, name: f.name, departments: depts.filter((d) => d.facilityId === f.id).map((d) => ({ id: d.id, name: d.name })) }));
  const posOptions = pos.map((p) => ({ id: p.id, name: p.name }));
  const typeOf = { legalEntities: "legal_entity", locations: "location", positions: "position", departments: "department" } as const;
  const gaps = (["legalEntities", "locations", "positions", "departments"] as const).flatMap((k) => Object.entries(unmapped[k] ?? {}).map(([value, count]) => ({ type: typeOf[k], value, count })));
  const typeLabel = (t: string) => (t === "legal_entity" ? "legal entity" : t);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Needs mapping" description="Values Paycor sent in the last sync that don’t match a facility, department or classification yet." />
        <CardBody>
          {gaps.length === 0 ? (
            <p className="text-[14px] text-muted">Everything from the last sync is mapped.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {gaps.map((g) => (
                <div key={`${g.type}-${g.value}`} className="rounded-2xl border border-line p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12px] uppercase tracking-wide text-faint">Paycor {typeLabel(g.type)}</div>
                      <div className="text-[15px] font-medium">“{g.value}”</div>
                    </div>
                    <Badge tone="caution">{g.count} employees</Badge>
                  </div>
                  {manage && <MapValueForm sourceType={g.type} sourceValue={g.value} facilities={facilityOptions} positions={posOptions} />}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      {manage && (
        <Card>
          <CardHeader title="Map a Paycor legal entity" description="Each legal entity (LLC) belongs to one facility. Employees whose Paycor work location doesn’t match a facility are placed by their legal entity." />
          <CardBody>
            <div className="max-w-md">
              <MapValueForm sourceType="legal_entity" facilities={facilityOptions} positions={posOptions} />
            </div>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Current mappings" description="How Paycor values translate into facilities, departments and job classifications. Values that match a name exactly don’t need a mapping." />
        <div className="pt-3">
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Paycor value</Th>
                <Th>Maps to</Th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.mapping.id}>
                  <Td className="capitalize text-ink-2">{typeLabel(m.mapping.sourceType)}</Td>
                  <Td className="font-medium">{m.mapping.sourceValue}</Td>
                  <Td>{m.mapping.sourceType === "location" || m.mapping.sourceType === "legal_entity" ? m.facilityName : m.mapping.sourceType === "position" ? m.positionName : `${m.departmentName} · ${m.facilityName}`}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function ReconciliationTab({ issues }: { issues: Awaited<ReturnType<typeof reconciliation>> }) {
  const tone = { high: "critical", medium: "caution", low: "neutral" } as const;
  return (
    <Card>
      <CardHeader title="Reconciliation" description="Where Paycor and Attendance on Demand disagree. Fix each item in the source system; this platform never creates or merges employees automatically." />
      <div className="pt-3">
        {issues.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title="Everything reconciles" />
        ) : (
          <ul className="divide-y divide-line">
            {issues.map((i, n) => (
              <li key={n} className="flex gap-4 px-6 py-3.5">
                <Badge tone={tone[i.severity]} className="mt-0.5 h-fit shrink-0">
                  {i.label}
                </Badge>
                <span className="text-[14px] text-ink-2">
                  {i.message}{" "}
                  {i.employeeId && (
                    <Link href={`/employees/${i.employeeId}`} className="text-accent hover:underline">
                      View employee
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
