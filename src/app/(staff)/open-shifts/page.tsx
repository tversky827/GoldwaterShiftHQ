import { CalendarPlus, PhoneOff, Repeat } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th, type Tone } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { requireStaff } from "@/server/context";
import { listFacilities } from "@/server/facilities";
import { facilityMarketplace, hasMarketplaceAccess, unfilledShifts, upcomingAssignments } from "@/server/marketplace/listings";
import { marketplaceConfig } from "@/server/marketplace/settings";
import { can } from "@/server/rbac/access";
import { CalloutDialog, FacilityPicker, PublishDialog, ReviewClaimDialog, SwapDecisionDialog, WithdrawButton } from "./dialogs";

export const metadata = { title: "Open shifts" };
export const dynamic = "force-dynamic";


const STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "accent" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  filled: { label: "Filled", tone: "positive" },
  expired: { label: "Closed", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};
const CALLOUT: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Needs coverage", tone: "critical" },
  covered: { label: "Covered", tone: "positive" },
  uncovered: { label: "Uncovered", tone: "caution" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const LEVEL = ["Posted to this facility’s staff", "Widened to other facilities and the pool", "Leadership alerted"];

export default async function OpenShiftsPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const db = await getDb();
  const facilities = (await listFacilities(db, actor)).filter((f) => f.isActive && can(actor, "schedules.view", { facilityId: f.id }) && hasMarketplaceAccess(actor, f.id));
  if (!facilities.length) return <EmptyState icon={<CalendarPlus />} title="No open-shift access" description="You don't manage open shifts for any facility." />;
  const facility = facilities.find((f) => f.id === sp.facilityId) ?? facilities[0];
  if (sp.facilityId !== facility.id) redirect(`/open-shifts?facilityId=${facility.id}`);

  const tz = facility.timezone;
  const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const range = (a: Date, b: Date) => `${timeFmt.format(a)} – ${timeFmt.format(b)}`;
  const when = (a: Date, b?: Date) => `${dayFmt.format(a)}, ${b ? range(a, b) : timeFmt.format(a)}`;

  const [market, unfilled, upcoming, cfg] = await Promise.all([facilityMarketplace(db, actor, facility.id), unfilledShifts(db, actor, facility.id, 14), upcomingAssignments(db, actor, facility.id), marketplaceConfig(db, actor.organizationId, facility.id)]);
  const manage = can(actor, "marketplace.manage", { facilityId: facility.id });
  const live = market.listings.filter((l) => l.listing.status === "open" || l.listing.status === "scheduled");
  const unlisted = unfilled.filter((u) => !u.listing);
  const openCallouts = market.callouts.filter((c) => c.callout.status === "open");
  const review = market.claims.length + market.swaps.length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={facility.name}
        title="Open shifts"
        subtitle="Publish openings, review pick-ups, and cover callouts."
        action={
          <>
            <FacilityPicker facilities={facilities.map((f) => ({ id: f.id, name: f.name }))} current={facility.id} />
            {manage && (
              <PublishDialog
                timezone={tz}
                defaultExpiry={cfg.expiryHoursBefore}
                defaultApproval={cfg.requireApproval}
                shifts={unlisted.map((u) => ({ id: u.id, day: dayFmt.format(u.startsAt), dayKey: u.startsAt.toISOString().slice(0, 10), time: range(u.startsAt, u.endsAt), position: u.positionCode, department: u.departmentName, open: u.open }))}
              />
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Listed now" value={live.length} hint={`${live.reduce((s, l) => s + Math.max(0, l.requiredCount - l.filled), 0)} openings`} />
        <Stat label="Needs your review" value={review} tone={review ? "caution" : undefined} hint="Pick-ups and swaps" />
        <Stat label="Callouts needing coverage" value={openCallouts.length} tone={openCallouts.length ? "critical" : undefined} />
        <Stat label="Unlisted openings" value={unlisted.reduce((s, u) => s + u.open, 0)} hint="Next 14 days" />
      </div>

      {review > 0 && (
        <Card>
          <CardHeader title="Needs your review" description="Rules are checked again when you decide." />
          <CardBody className="divide-y divide-line px-0 py-2">
            {market.claims.map((c) => {
              const ev = (c.claim.ruleEvaluation as { results?: { outcome: string; message: string }[] } | null)?.results ?? [];
              const reasons = ev.filter((r) => r.outcome !== "warning").map((r) => r.message);
              const notes = ev.filter((r) => r.outcome === "warning").map((r) => r.message);
              const who = `${c.first} ${c.last}`;
              return (
                <div key={c.claim.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
                  <CalendarPlus className="size-4 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">
                      {who} wants {c.positionCode} · {when(c.startsAt, c.endsAt)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.homeFacilityId !== facility.id && <Badge>{c.isPool ? "Regional pool" : "Other facility"}</Badge>}
                      {reasons.map((r) => (
                        <Badge key={r} tone="caution">
                          {r}
                        </Badge>
                      ))}
                      {!reasons.length && c.requiresApproval && <Badge>Facility reviews all pick-ups</Badge>}
                      {notes.map((r) => (
                        <Badge key={r}>{r}</Badge>
                      ))}
                    </div>
                  </div>
                  <ReviewClaimDialog claimId={c.claim.id} who={c.first} shift={`${c.positionCode} · ${when(c.startsAt, c.endsAt)}`} reasons={reasons} />
                </div>
              );
            })}
            {market.swaps.map((s) => (
              <div key={s.swap.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
                <Repeat className="size-4 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">
                    Swap: {s.first} {s.last} ↔ {s.targetName ? `${s.targetName.first} ${s.targetName.last}` : "colleague"}
                  </div>
                  <div className="text-[13px] text-muted">
                    {s.positionCode} · {dayFmt.format(s.startsAt)} {s.target ? `for ${dayFmt.format(s.target.startsAt)}` : ""}
                    {s.swap.note ? ` · “${s.swap.note}”` : ""}
                  </div>
                </div>
                <SwapDecisionDialog swapId={s.swap.id} title="Review shift swap" description={`${s.first} gives up ${when(s.startsAt)}${s.target && s.targetName ? `; ${s.targetName.first} gives up ${when(s.target.startsAt)}` : ""}.`} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Callouts"
          description={`If nobody picks one up, it widens to other facilities after ${cfg.escalationMinutes[0]} minutes and alerts leadership ${cfg.escalationMinutes[1]} minutes later.`}
          action={can(actor, "callouts.manage", { facilityId: facility.id }) ? <CalloutDialog assignments={upcoming.map((a) => ({ id: a.id, label: `${a.first} ${a.last} · ${a.positionCode} · ${when(a.startsAt, a.endsAt)}` }))} /> : undefined}
        />
        <CardBody className="px-0 py-2">
          {market.callouts.length === 0 ? (
            <p className="px-6 py-4 text-[14px] text-muted">No recent callouts.</p>
          ) : (
            <div className="divide-y divide-line">
              {market.callouts.map((c) => (
                <div key={c.callout.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3">
                  <PhoneOff className="size-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">
                      {c.first} {c.last} · {c.positionCode} · {when(c.startsAt)}
                    </div>
                    <div className="text-[13px] text-muted">
                      {c.callout.reason ?? "No reason given"}
                      {c.callout.status === "open" ? ` · ${LEVEL[c.callout.escalationLevel] ?? LEVEL[2]}` : ""}
                    </div>
                  </div>
                  <Badge tone={CALLOUT[c.callout.status].tone}>{CALLOUT[c.callout.status].label}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Listings" description="Open, scheduled and recently closed listings." />
        {market.listings.length === 0 ? (
          <EmptyState icon={<CalendarPlus />} title="Nothing listed yet" description={manage ? "Use “Publish open shifts” to offer unfilled shifts to qualified staff." : "Open shifts published for this facility will appear here."} />
        ) : (
          <Table className="mt-3">
            <thead>
              <tr>
                <Th>Shift</Th>
                <Th>Position</Th>
                <Th>Filled</Th>
                <Th>Requests</Th>
                <Th>Closes</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {market.listings.map((l) => (
                <tr key={l.listing.id}>
                  <Td>
                    <div className="font-medium">{dayFmt.format(l.startsAt)}</div>
                    <div className="tabular text-[13px] text-muted">{range(l.startsAt, l.endsAt)}</div>
                  </Td>
                  <Td>
                    {l.positionCode}
                    {l.isCallout && (
                      <Badge tone="critical" className="ml-2">
                        Callout
                      </Badge>
                    )}
                    {l.listing.incentiveText && <div className="text-[12px] text-accent">{l.listing.incentiveText}</div>}
                  </Td>
                  <Td className="tabular">
                    {l.filled}/{l.requiredCount}
                  </Td>
                  <Td className="tabular text-[13px] text-ink-2">
                    {l.pendingClaims ? `${l.pendingClaims} pending` : "—"}
                    {l.waitlist ? ` · ${l.waitlist} waiting` : ""}
                  </Td>
                  <Td className="text-[13px] text-ink-2">{l.listing.status === "scheduled" ? `Opens ${when(l.listing.publishAt)}` : l.listing.expiresAt ? when(l.listing.expiresAt) : "At start"}</Td>
                  <Td>
                    <Badge tone={STATUS[l.listing.status].tone}>{STATUS[l.listing.status].label}</Badge>
                  </Td>
                  <Td className="text-right">{manage && (l.listing.status === "open" || l.listing.status === "scheduled") && <WithdrawButton listingId={l.listing.id} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
