import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { departments, positions } from "@/db/schema";
import { EMPLOYMENT_TYPE_LABEL, STATUS_LABEL } from "@/lib/format";
import { requirePermission } from "@/server/context";
import { listEmployees, type EmployeeFilters } from "@/server/employees";
import { listFacilities } from "@/server/facilities";

export const metadata = { title: "Employees" };
export const dynamic = "force-dynamic";

const statusTone = { active: "positive", leave: "caution", inactive: "neutral", terminated: "critical" } as const;

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePermission("employees.view");
  const sp = await searchParams;
  const db = await getDb();
  const filters: EmployeeFilters = {
    q: sp.q,
    facilityId: sp.facilityId || undefined,
    departmentId: sp.departmentId || undefined,
    positionId: sp.positionId || undefined,
    status: (sp.status as EmployeeFilters["status"]) || "active",
    pool: (sp.pool as EmployeeFilters["pool"]) || "all",
    employmentType: sp.type || undefined,
    page: Number(sp.page ?? 1),
  };
  const [result, facilities, posList] = await Promise.all([
    listEmployees(db, actor, filters),
    listFacilities(db, actor),
    db.select().from(positions).where(eq(positions.organizationId, actor.organizationId)).orderBy(asc(positions.sortOrder)),
  ]);
  const depts = filters.facilityId ? await db.select().from(departments).where(eq(departments.facilityId, filters.facilityId)).orderBy(asc(departments.sortOrder)) : [];
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries({ ...sp, page: String(page) }).filter(([, v]) => v) as [string, string][]);
    return `/employees?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Employees" subtitle={`${result.total.toLocaleString()} ${filters.status === "all" ? "" : (STATUS_LABEL[filters.status ?? "active"] ?? "").toLowerCase() + " "}employees · imported from Paycor`} />

      <form className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_repeat(5,minmax(0,170px))]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input name="q" defaultValue={sp.q} placeholder="Search name or employee #" className="pl-10" aria-label="Search employees" />
        </div>
        <Select name="facilityId" defaultValue={filters.facilityId ?? ""} aria-label="Facility">
          <option value="">All facilities</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        {depts.length > 0 ? (
          <Select name="departmentId" defaultValue={filters.departmentId ?? ""} aria-label="Department">
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        ) : (
          <Select name="positionId" defaultValue={filters.positionId ?? ""} aria-label="Position">
            <option value="">All positions</option>
            {posList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Select name="type" defaultValue={filters.employmentType ?? ""} aria-label="Employment type">
          <option value="">All types</option>
          {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select name="pool" defaultValue={filters.pool} aria-label="Regional pool">
          <option value="all">Pool and facility staff</option>
          <option value="pool">Regional pool only</option>
          <option value="non_pool">Facility staff only</option>
        </Select>
        <div className="flex gap-2">
          <Select name="status" defaultValue={filters.status} aria-label="Status">
            <option value="active">Active</option>
            <option value="leave">On leave</option>
            <option value="inactive">Inactive</option>
            <option value="terminated">Terminated</option>
            <option value="all">All statuses</option>
          </Select>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </div>
      </form>

      <Card>
        {result.rows.length === 0 ? (
          <EmptyState icon={<Users />} title="No employees match" description="Try clearing a filter. Employees are imported automatically from Paycor." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="hidden md:table-cell">Position</Th>
                <Th className="hidden lg:table-cell">Home facility</Th>
                <Th className="hidden sm:table-cell">Type</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-fill/60">
                  <Td>
                    <Link href={`/employees/${e.id}`} className="flex items-center gap-3">
                      <Avatar name={`${e.preferredName ?? e.firstName} ${e.lastName}`} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {e.preferredName ?? e.firstName} {e.lastName}
                        </span>
                        <span className="block text-[12px] text-muted">#{e.employeeNumber ?? "—"}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="hidden md:table-cell">
                    <span className="font-medium">{e.positions[0] ?? "—"}</span>
                    {e.positions.length > 1 && <span className="text-muted"> +{e.positions.length - 1}</span>}
                  </Td>
                  <Td className="hidden lg:table-cell">
                    {e.isRegionalPool ? <Badge tone="accent">Regional pool</Badge> : <span className="text-ink-2">{e.facilityName ?? "—"}</span>}
                    {e.departmentName && !e.isRegionalPool && <div className="text-[12px] text-muted">{e.departmentName}</div>}
                  </Td>
                  <Td className="hidden text-ink-2 sm:table-cell">{EMPLOYMENT_TYPE_LABEL[e.employmentType]}</Td>
                  <Td>
                    <Badge tone={statusTone[e.employmentStatus]}>{STATUS_LABEL[e.employmentStatus]}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 text-[13px] text-muted">
            <span>
              Page {result.page} of {pages}
            </span>
            <div className="flex gap-1">
              <Button asChild variant="quiet" size="sm" aria-disabled={result.page <= 1} className={result.page <= 1 ? "pointer-events-none opacity-40" : ""}>
                <Link href={qs(result.page - 1)}>
                  <ChevronLeft /> Previous
                </Link>
              </Button>
              <Button asChild variant="quiet" size="sm" aria-disabled={result.page >= pages} className={result.page >= pages ? "pointer-events-none opacity-40" : ""}>
                <Link href={qs(result.page + 1)}>
                  Next <ChevronRight />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
