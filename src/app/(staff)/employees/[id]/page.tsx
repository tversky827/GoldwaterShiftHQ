import { CalendarClock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, KeyValue, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { EMPLOYMENT_TYPE_LABEL, formatDate, formatDateTime, relativeTime, STATUS_LABEL } from "@/lib/format";
import { requireStaff } from "@/server/context";
import { getEmployeeProfile } from "@/server/employees";
import { listFacilities } from "@/server/facilities";
import { can } from "@/server/rbac/access";
import { AuthorizeDialog, InviteDialog, PoolDialog, RevokeButton } from "./dialogs";

export const metadata = { title: "Employee" };
export const dynamic = "force-dynamic";

const statusTone = { active: "positive", leave: "caution", inactive: "neutral", terminated: "critical" } as const;
const credTone = { verified: "positive", pending_verification: "caution", expired: "critical", revoked: "critical" } as const;
const credLabel = { verified: "Verified", pending_verification: "Needs verification", expired: "Expired", revoked: "Revoked" } as const;

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireStaff();
  const db = await getDb();
  const p = await getEmployeeProfile(db, actor, id).catch(() => null);
  if (!p) {
    return <EmptyState title="Employee not available" description="This employee doesn't exist or isn't in a facility you can access." />;
  }
  const e = p.employee;
  const name = `${e.preferredName ?? e.firstName} ${e.lastName}`;
  const authorizedIds = new Set(p.authorizations.map((a) => a.authorization.facilityId));
  const facilities = p.permissions.authorizeFacility ? (await listFacilities(db, actor)).filter((f) => f.id !== e.homeFacilityId && !authorizedIds.has(f.id) && can(actor, "employees.authorize_facility", { facilityId: f.id })) : [];
  const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const inactive = e.employmentStatus === "inactive" || e.employmentStatus === "terminated";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/employees" className="hover:text-accent">
            Employees
          </Link>
        }
        title={
          <span className="flex items-center gap-4">
            <Avatar name={name} className="size-12 text-[16px]" />
            <span>{name}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[e.employmentStatus]}>{STATUS_LABEL[e.employmentStatus]}</Badge>
            {e.isRegionalPool && <Badge tone="accent">Regional pool</Badge>}
            <span>
              {p.positions.find((x) => x.isPrimary)?.name ?? e.paycorPosition ?? "No position"} · #{e.employeeNumber ?? "—"}
            </span>
          </span>
        }
        action={
          <>
            {p.permissions.managePool && !inactive && <PoolDialog employeeId={id} isPool={e.isRegionalPool} name={name} />}
            {p.permissions.invite && !inactive && p.account?.status !== "active" && <InviteDialog employeeId={id} email={e.email} hasPending={p.account?.status === "invited"} />}
          </>
        }
      />

      {inactive && (
        <div className="mb-6 rounded-2xl bg-fill px-5 py-4 text-[14px] text-ink-2">
          This employee is <strong>{STATUS_LABEL[e.employmentStatus].toLowerCase()}</strong> in Paycor{e.terminationDate ? ` (as of ${formatDate(e.terminationDate)})` : ""}. They can’t be scheduled or claim shifts. Their history is preserved below.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Employment" description="From Paycor, the system of record. Changes are made in Paycor and sync automatically." />
            <CardBody>
              <KeyValue
                items={[
                  { label: "Home facility", value: e.isRegionalPool ? "Regional staffing pool" : (p.facilityName ?? (e.paycorLocation ? `Unmapped: ${e.paycorLocation}` : "—")) },
                  { label: "Department", value: p.departmentName ?? e.paycorDepartment },
                  { label: "Employment type", value: EMPLOYMENT_TYPE_LABEL[e.employmentType] },
                  { label: "Paycor position", value: e.paycorPosition },
                  { label: "Hire date", value: formatDate(e.hireDate) },
                  { label: "Termination date", value: e.terminationDate ? formatDate(e.terminationDate) : "—" },
                  ...(p.showContact ? [{ label: "Email", value: e.email }, { label: "Mobile", value: e.mobilePhone }] : []),
                  { label: "Paycor employee ID", value: <span className="font-mono text-[13px]">{e.paycorEmployeeId ?? "—"}</span> },
                  { label: "Last synced", value: e.lastSyncedAt ? relativeTime(e.lastSyncedAt) : "—" },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Credentials" description="Required credentials are checked before every assignment and claim." />
            {p.credentials.length === 0 ? (
              <EmptyState icon={<ShieldCheck />} title="No credentials on file" />
            ) : (
              <div className="pt-3">
                <Table>
                  <thead>
                    <tr>
                      <Th>Credential</Th>
                      <Th>Expires</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.credentials.map(({ credential: c, typeName }) => {
                      const expired = c.expiresOn && c.expiresOn < new Date().toISOString().slice(0, 10);
                      const status = expired ? "expired" : c.status;
                      return (
                        <tr key={c.id}>
                          <Td className="font-medium">{typeName}</Td>
                          <Td className="tabular">
                            {formatDate(c.expiresOn)}
                            {!expired && c.expiresOn && c.expiresOn < soon && <Badge tone="caution" className="ml-2">Expiring soon</Badge>}
                          </Td>
                          <Td>
                            <Badge tone={credTone[status]}>{credLabel[status]}</Badge>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Assignment history" description="Kept permanently, including after deactivation." />
            {p.history.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="No assignments yet" description="Assignments appear here once the employee is scheduled." />
            ) : (
              <div className="pt-3">
                <Table>
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Facility</Th>
                      <Th>Position</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.history.map((h) => (
                      <tr key={h.id}>
                        <Td className="tabular">{formatDateTime(h.startsAt)}</Td>
                        <Td>{h.facilityName}</Td>
                        <Td>{h.positionCode}</Td>
                        <Td>
                          <Badge>{h.status.replace("_", " ")}</Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Job classifications" />
            <CardBody className="flex flex-wrap gap-1.5">
              {p.positions.length === 0 ? (
                <span className="text-[14px] text-muted">None mapped yet{e.paycorPosition ? ` (Paycor: ${e.paycorPosition})` : ""}.</span>
              ) : (
                p.positions.map((x) => (
                  <Badge key={x.id} tone={x.isPrimary ? "accent" : "neutral"}>
                    {x.name}
                    {x.isPrimary && " · primary"}
                  </Badge>
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Authorized facilities" description="Where this employee may work besides their home facility." action={p.permissions.authorizeFacility && !inactive && facilities.length > 0 && <AuthorizeDialog employeeId={id} facilities={facilities} />} />
            <CardBody>
              {p.authorizations.length === 0 ? (
                <p className="text-[14px] text-muted">{e.isRegionalPool ? "No facilities authorized yet. Pool employees only see shifts at authorized facilities." : "Home facility only."}</p>
              ) : (
                <ul className="space-y-2">
                  {p.authorizations.map((a) => (
                    <li key={a.authorization.id} className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[15px]">{a.facilityName}</div>
                        {a.authorization.reason && <div className="text-[12px] text-muted">{a.authorization.reason}</div>}
                      </div>
                      {p.permissions.authorizeFacility && can(actor, "employees.authorize_facility", { facilityId: a.authorization.facilityId }) && <RevokeButton employeeId={id} authorizationId={a.authorization.id} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {p.showPay && (
            <Card>
              <CardHeader title="Compensation" description="From Paycor. Visible only to people with pay access." />
              <CardBody className="space-y-2 text-[14px]">
                {p.payRates.length === 0 ? (
                  <span className="text-muted">No pay rate imported.</span>
                ) : (
                  p.payRates.map((r) => (
                    <div key={r.id} className={r.effectiveTo ? "flex justify-between text-faint" : "flex justify-between"}>
                      <span>
                        {r.effectiveTo ? `${formatDate(r.effectiveFrom)} – ${formatDate(r.effectiveTo)}` : `Current · since ${formatDate(r.effectiveFrom)}`}
                        {r.payType === "salary" && " · salaried (hourly equivalent)"}
                      </span>
                      <span className="tabular font-semibold">${Number(r.hourlyRate).toFixed(2)}/hr</span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="App access" />
            <CardBody className="text-[14px]">
              {p.account ? (
                <div className="space-y-1">
                  <Badge tone={p.account.status === "active" ? "positive" : p.account.status === "invited" ? "caution" : "neutral"}>{p.account.status === "active" ? "Active" : p.account.status === "invited" ? "Invitation sent" : "Disabled"}</Badge>
                  <div className="text-muted">{p.showContact ? p.account.email : "Signed in"} · last sign-in {relativeTime(p.account.lastLoginAt)}</div>
                </div>
              ) : (
                <span className="text-muted">Not invited yet.</span>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
