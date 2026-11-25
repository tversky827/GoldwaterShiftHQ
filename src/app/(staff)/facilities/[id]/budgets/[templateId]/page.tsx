import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { departments } from "@/db/schema";
import { requirePermission } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { can } from "@/server/rbac/access";
import { budgetEditorData } from "@/server/scheduling/budgets";
import { BudgetDetailsForm, CopyBudgetDialog } from "./budget-dialogs";
import { BudgetMatrix } from "./matrix";

export const metadata = { title: "Staffing budget" };
export const dynamic = "force-dynamic";

export default async function BudgetEditorPage({ params }: { params: Promise<{ id: string; templateId: string }> }) {
  const { id, templateId } = await params;
  const actor = await requirePermission("budgets.view", { facilityId: id });
  const db = await getDb();
  const data = await budgetEditorData(db, actor, templateId);
  const editable = can(actor, "budgets.manage", { facilityId: id });
  const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, id)).orderBy(asc(departments.sortOrder));
  const copyTargets = editable ? (await listFacilities(db, actor)).filter((f) => f.id !== id && can(actor, "budgets.manage", { facilityId: f.id })) : [];
  const t = data.template;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/facilities/${id}?tab=budget`} className="hover:text-accent">
            {data.facility.name} · Staffing budget
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {t.name}
            <Badge tone={t.isActive ? "positive" : "neutral"}>{t.isActive ? "Active" : "Inactive"}</Badge>
          </span>
        }
        subtitle="How many people each shift needs, by position and day. This is need, not assignments. Schedules fill it."
        action={editable && copyTargets.length > 0 ? <CopyBudgetDialog templateId={t.id} facilities={copyTargets.map((f) => ({ id: f.id, name: f.name }))} /> : undefined}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Staffing by shift and day" description={editable ? "Changed cells are highlighted until saved. “Fill” copies Monday to every day." : undefined} />
          <div className="pt-3">
            {data.sections.length === 0 ? (
              <CardBody className="text-[14px] text-muted">This facility has no active shifts or job classifications yet. Add them on the facility page first.</CardBody>
            ) : (
              <BudgetMatrix templateId={t.id} facilityId={id} sections={data.sections} editable={editable} />
            )}
          </div>
        </Card>
        {editable && (
          <Card className="h-fit">
            <CardHeader title="Details" />
            <CardBody>
              <BudgetDetailsForm facilityId={id} template={t} departments={depts} />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
