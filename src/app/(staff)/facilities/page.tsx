import { Building2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { timezoneShort } from "@/lib/format";
import { requirePermission } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { hasOrgWide } from "@/server/rbac/access";

export const metadata = { title: "Facilities" };
export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const actor = await requirePermission("facilities.view");
  const facilities = await listFacilities(await getDb(), actor);
  const canAdd = hasOrgWide(actor, "facilities.manage");
  return (
    <>
      <PageHeader
        title="Facilities"
        subtitle={`${facilities.length} ${facilities.length === 1 ? "facility" : "facilities"}`}
        action={
          canAdd ? (
            <Button asChild>
              <Link href="/facilities/new">Add facility</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        {facilities.length === 0 ? (
          <EmptyState icon={<Building2 />} title="No facilities yet" description="Facilities are created here by a corporate administrator. None are built in." />
        ) : (
          <ul className="divide-y divide-line">
            {facilities.map((f) => (
              <li key={f.id}>
                <Link href={`/facilities/${f.id}`} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-fill/60">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill text-[12px] font-semibold text-ink-2">{f.code}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium">{f.name}</span>
                      {!f.isActive && <Badge>Inactive</Badge>}
                    </div>
                    <div className="text-[13px] text-muted">
                      {[f.city, f.state].filter(Boolean).join(", ") || "No address"} · {timezoneShort(f.timezone)}
                    </div>
                  </div>
                  <div className="hidden text-right text-[13px] text-muted sm:block">
                    <div className="tabular">{f.activeEmployees} active staff</div>
                    <div className="tabular">{f.departmentCount} departments</div>
                  </div>
                  <ChevronRight className="size-4 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
