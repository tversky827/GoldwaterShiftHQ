import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { requirePermission } from "@/server/context";
import { listPositions } from "@/server/facilities";
import { hasOrgWide } from "@/server/rbac/access";
import { AddClassification } from "./add-classification";

export const metadata = { title: "Classifications" };
export const dynamic = "force-dynamic";

export default async function ClassificationsPage() {
  const actor = await requirePermission("facilities.view");
  const positions = await listPositions(await getDb(), actor);
  return (
    <Card>
      <CardHeader title="Job classifications" description="Organization-wide list. Each facility chooses which of these it schedules." action={hasOrgWide(actor, "positions.manage") && <AddClassification />} />
      <div className="pt-3">
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Type</Th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-[13px]">{p.code}</Td>
                <Td className="font-medium">{p.name}</Td>
                <Td>{p.isClinical ? <Badge tone="accent">Clinical</Badge> : <Badge>Non-clinical</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
