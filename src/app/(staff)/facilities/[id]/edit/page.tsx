import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { requirePermission } from "@/server/context";
import { getFacility, TIMEZONES } from "@/server/facilities";
import { updateFacilityAction } from "../../actions";
import { FacilityForm } from "../../facility-form";

export const metadata = { title: "Edit facility" };
export const dynamic = "force-dynamic";

export default async function EditFacilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("facilities.manage", { facilityId: id });
  const { facility } = await getFacility(await getDb(), actor, id);
  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow={facility.name} title="Facility details" />
      <Card>
        <CardBody>
          <FacilityForm action={updateFacilityAction} timezones={TIMEZONES} values={facility} submitLabel="Save changes" />
        </CardBody>
      </Card>
    </div>
  );
}
