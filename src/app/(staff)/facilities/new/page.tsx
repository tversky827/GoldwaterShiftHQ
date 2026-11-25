import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/context";
import { TIMEZONES } from "@/server/facilities";
import { createFacilityAction } from "../actions";
import { FacilityForm } from "../facility-form";

export const metadata = { title: "Add facility" };

export default async function NewFacilityPage() {
  await requirePermission("facilities.manage");
  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Facilities" title="Add a facility" subtitle="You can add departments, units, shifts and staffing budgets next." />
      <Card>
        <CardBody>
          <FacilityForm action={createFacilityAction} timezones={TIMEZONES} submitLabel="Create facility" />
        </CardBody>
      </Card>
    </div>
  );
}
