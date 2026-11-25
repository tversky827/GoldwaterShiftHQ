import { Badge, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { requireStaff } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { marketplaceConfig } from "@/server/marketplace/settings";
import { can, hasOrgWide } from "@/server/rbac/access";
import { redirect } from "next/navigation";
import { MarketplaceSettingsForm, ScopePicker } from "./form";

export const metadata = { title: "Marketplace settings" };
export const dynamic = "force-dynamic";

export default async function MarketplaceSettingsPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const actor = await requireStaff();
  const { facilityId } = await searchParams;
  const db = await getDb();
  const orgWide = hasOrgWide(actor, "marketplace.manage");
  const facilities = (await listFacilities(db, actor)).filter((f) => f.isActive && can(actor, "marketplace.manage", { facilityId: f.id }));
  if (!orgWide && !facilities.length) redirect("/forbidden");
  const facility = facilities.find((f) => f.id === facilityId) ?? (orgWide ? null : facilities[0]);
  const values = await marketplaceConfig(db, actor.organizationId, facility?.id ?? null);
  const scopes = [...(orgWide ? [{ id: "", name: "All facilities (organization default)" }] : []), ...facilities.map((f) => ({ id: f.id, name: f.name }))];

  return (
    <Card>
      <CardHeader
        title="Open shift marketplace"
        description={facility ? `Settings for ${facility.name}.` : "The default for every facility. A facility can have its own settings."}
        action={<ScopePicker scopes={scopes} current={facility?.id ?? ""} />}
      />
      <CardBody>
        {facility && (
          <div className="mb-5">
            <Badge tone={values.source === "facility" ? "accent" : "neutral"}>{values.source === "facility" ? "Customized for this facility" : "Following the organization default"}</Badge>
          </div>
        )}
        <MarketplaceSettingsForm facilityId={facility?.id ?? null} values={values} canEdit={facility ? true : orgWide} />
      </CardBody>
    </Card>
  );
}
