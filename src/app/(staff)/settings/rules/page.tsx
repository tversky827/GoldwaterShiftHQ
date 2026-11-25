import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { PARAM_FIELDS, rulesForScope } from "@/server/scheduling/rule-settings";
import { ConfirmForm, CustomizeButton, OvertimeForm, RemoveFacilityRuleButton, RuleForm } from "./rule-forms";

export const metadata = { title: "Rules" };
export const dynamic = "force-dynamic";

const DESCRIPTION: Record<string, string> = {
  overlapping_shifts: "An employee can't work two shifts at the same time, at any facility.",
  facility_authorization: "Employees can only work at their home facility or facilities they're authorized for.",
  position_qualification: "Employees can only fill positions they're classified for.",
  credential_required: "Required licenses and certifications must be verified and unexpired on the shift date.",
  min_rest_hours: "Minimum time off between the end of one shift and the start of the next.",
  max_daily_hours: "Total paid hours an employee can work in one day.",
  max_weekly_hours: "Hard ceiling on projected weekly hours across all facilities.",
  max_consecutive_days: "How many days in a row an employee can be scheduled.",
  employment_classification: "Weekly hour guidelines by employment type (e.g. part-time).",
  availability: "Days the employee has marked as unavailable in the app.",
};
const OUTCOME_TONE = { warning: "caution", approval_required: "accent", hard_block: "critical" } as const;
const OUTCOME_LABEL = { warning: "Warn", approval_required: "Approval", hard_block: "Block" } as const;

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const actor = await requirePermission("rules.view");
  const { facilityId } = await searchParams;
  const db = await getDb();
  const facilities = await listFacilities(db, actor);
  const facility = facilities.find((f) => f.id === facilityId);
  const data = await rulesForScope(db, actor, facility?.id);

  return (
    <div className="space-y-4">
      {data.confirmed ? (
        <div className="flex items-center gap-3 rounded-2xl bg-positive-soft px-5 py-4 text-[14px] text-positive">
          <CheckCircle2 className="size-5" /> Rules confirmed{data.overtime?.confirmedAt ? ` on ${formatDateTime(data.overtime.confirmedAt)}` : ""}. Any change requires confirming again.
        </div>
      ) : (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-caution" /> These are example values
              </span>
            }
            description="Nothing here is legal advice. Review each rule against your state requirements, company policy and any union contracts, adjust it, then confirm. Until then, schedulers see a reminder."
          />
          {data.canManageOrg && (
            <CardBody>
              <ConfirmForm />
            </CardBody>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">Showing rules for</span>
        <Link href="/settings/rules" className={cn("rounded-full px-3.5 py-1.5 text-[14px]", !facility ? "bg-ink text-white" : "bg-fill text-ink-2")}>
          All facilities
        </Link>
        <form className="contents">
          <select name="facilityId" defaultValue={facility?.id ?? ""} className="h-9 rounded-full border border-line-strong bg-surface px-3 text-[14px]" aria-label="Facility">
            <option value="">Choose a facility…</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="rounded-full bg-fill px-3.5 py-1.5 text-[14px]">Show</button>
        </form>
      </div>

      {data.overtime && !facility && (
        <Card>
          <CardHeader title="Overtime" description="Projected weekly hours across ALL facilities: actual hours where clocked, plus scheduled hours." action={<Badge tone={OUTCOME_TONE[data.overtime.outcome]}>{OUTCOME_LABEL[data.overtime.outcome]}</Badge>} />
          <CardBody>
            <OvertimeForm ot={data.overtime} editable={data.canManageOrg} />
          </CardBody>
        </Card>
      )}

      {data.rules.map(({ org, facility: fr, locked }) => {
        const active = fr ?? org;
        return (
          <Card key={org.id}>
            <CardHeader
              title={org.name}
              description={DESCRIPTION[org.ruleType]}
              action={
                <span className="flex items-center gap-2">
                  {fr && <Badge tone="accent">Customized for {facility?.code}</Badge>}
                  {!active.isActive && <Badge>Off</Badge>}
                  <Badge tone={OUTCOME_TONE[active.outcome]}>{OUTCOME_LABEL[active.outcome]}</Badge>
                </span>
              }
            />
            <CardBody>
              {facility && !fr ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[14px] text-muted">Uses the organization rule.</span>
                  {data.canManageFacility && !locked && <CustomizeButton ruleId={org.id} facilityId={facility.id} label={`Customize for ${facility.code}`} />}
                </div>
              ) : (
                <>
                  <RuleForm rule={{ id: active.id, ruleType: active.ruleType, outcome: active.outcome, overridable: active.overridable, isActive: active.isActive, params: active.params as Record<string, unknown> }} fields={PARAM_FIELDS[org.ruleType] ?? []} locked={locked} editable={fr ? data.canManageFacility : data.canManageOrg} />
                  {fr && data.canManageFacility && (
                    <div className="mt-2">
                      <RemoveFacilityRuleButton ruleId={fr.id} />
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
