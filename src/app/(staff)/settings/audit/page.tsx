import { Badge, Card, CardHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { formatDateTime } from "@/lib/format";
import { listAudit } from "@/server/audit-view";
import { requirePermission } from "@/server/context";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "", label: "All activity" },
  { value: "employee.", label: "Employee changes" },
  { value: "user.", label: "Users & permissions" },
  { value: "role.", label: "Role changes" },
  { value: "facility.", label: "Facility configuration" },
  { value: "integration.", label: "Integrations" },
  { value: "auth.", label: "Sign-ins" },
];

function describe(action: string) {
  return action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const actor = await requirePermission("audit.view");
  const { action } = await searchParams;
  const rows = await listAudit(await getDb(), actor, { action, limit: 200 });
  return (
    <Card>
      <CardHeader
        title="Audit log"
        description="Every change to schedules, employees, permissions and integrations. Entries can’t be edited or deleted."
        action={
          <form className="flex gap-2">
            <Select name="action" defaultValue={action ?? ""} aria-label="Filter" className="h-9 w-52">
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" variant="secondary">
              Filter
            </Button>
          </form>
        }
      />
      <div className="pt-3">
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>What</Th>
              <Th>Who</Th>
              <Th className="hidden md:table-cell">Facility</Th>
              <Th className="hidden lg:table-cell">Details</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ log, actorName, facilityName }) => (
              <tr key={log.id}>
                <Td className="tabular whitespace-nowrap text-ink-2">{formatDateTime(log.createdAt)}</Td>
                <Td className="font-medium">{describe(log.action)}</Td>
                <Td>{log.actorType === "user" ? (actorName ?? "User") : <Badge>{log.actorType === "integration" ? "Integration" : "System"}</Badge>}</Td>
                <Td className="hidden text-ink-2 md:table-cell">{facilityName ?? "—"}</Td>
                <Td className="hidden max-w-[360px] truncate font-mono text-[12px] text-muted lg:table-cell" title={JSON.stringify({ before: log.before, after: log.after, reason: log.reason })}>
                  {log.reason ? `“${log.reason}” ` : ""}
                  {log.after ? JSON.stringify(log.after) : ""}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
