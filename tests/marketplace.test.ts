import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { callouts, employeePositions, employees, marketplaceListings, notifications, positions, roles, ruleOverrides, schedules, shiftAssignments, shiftClaims, shifts, shiftWaitlists, userRoles, users } from "@/db/schema";
import { addDaysStr, weekStartOf, zonedToUtc } from "@/lib/tz";
import { recordCallout, escalateCallouts } from "@/server/marketplace/callouts";
import { claimShift, joinWaitlist, openShiftsForMe, reviewClaim, withdrawClaim } from "@/server/marketplace/claims";
import { runMarketplaceJobs } from "@/server/marketplace/jobs";
import { facilityMarketplace, publishOpenShifts, unfilledShifts, withdrawListing } from "@/server/marketplace/listings";
import { marketplaceConfig, saveMarketplaceSettings } from "@/server/marketplace/settings";
import { decideSwap, mySwaps, requestSwap, respondToSwap, swapOptions } from "@/server/marketplace/swaps";
import { loadActor, type Actor } from "@/server/rbac/access";
import { assignEmployee, unassign } from "@/server/scheduling/assignments";
import { evaluateAssignment } from "@/server/scheduling/rules";
import { actorFor, ctxFor, demoDb, facilityByCode } from "./helpers";

let db: Db;
let orgId: string;
let corp: Actor, scheduler: Actor, don: Actor;
let mgr: { id: string; timezone: string }, crk: { id: string; timezone: string };
const people: Actor[] = []; // employee app users at MGR (CNA)
let rnAtMgr: Actor; // an MGR employee who is NOT a CNA
let cnaAtCrk: Actor; // a CNA at another facility, not authorized at MGR

// A future Sunday-start week, clear of demo punches.
const today = new Date().toISOString().slice(0, 10);
const WEEK = addDaysStr(weekStartOf(today, 0), 35);
const day = (n: number) => addDaysStr(WEEK, n);

async function newShift(facility: { id: string; timezone: string }, date: string, start = "07:00", hours = 8, required = 1, posCode = "CNA") {
  const [p] = await db.select().from(positions).where(and(eq(positions.organizationId, orgId), eq(positions.code, posCode)));
  const startsAt = zonedToUtc(date, start, facility.timezone);
  const [s] = await db
    .insert(shifts)
    .values({ facilityId: facility.id, positionId: p.id, workDate: date, startsAt, endsAt: new Date(startsAt.getTime() + hours * 3_600_000), paidHours: String(hours), requiredCount: required, source: "manual" })
    .returning();
  return s;
}

/** Gives an employee an app login with the Employee role. */
async function employeeUser(employeeId: string, email: string): Promise<Actor> {
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId));
  const [role] = await db.select().from(roles).where(and(eq(roles.organizationId, orgId), eq(roles.key, "employee")));
  const [u] = await db.insert(users).values({ organizationId: orgId, email, displayName: `${emp.firstName} ${emp.lastName}`, passwordHash: "x", status: "active", employeeId, isDemo: true }).returning();
  await db.insert(userRoles).values({ userId: u.id, roleId: role.id, scopeType: "organization" });
  return (await loadActor(db, u.id))!;
}

/** Active, full-time, non-pool employees at a facility whose assignment to a probe shift would be clean. */
async function cleanEmployees(facility: { id: string; timezone: string }, posCode: string, count: number) {
  const rows = await db
    .select({ id: employees.id, type: employees.employmentType })
    .from(employees)
    .innerJoin(employeePositions, eq(employeePositions.employeeId, employees.id))
    .innerJoin(positions, eq(positions.id, employeePositions.positionId))
    .where(and(eq(employees.homeFacilityId, facility.id), eq(employees.employmentStatus, "active"), eq(positions.code, posCode), eq(employees.isRegionalPool, false)));
  const probe = await newShift(facility, day(-14), "07:00", 8, 99, posCode);
  const linked = new Set((await db.select({ e: users.employeeId }).from(users)).map((u) => u.e));
  const out: string[] = [];
  for (const r of rows) {
    if (r.type !== "full_time" || linked.has(r.id)) continue;
    const ev = await evaluateAssignment(db, { employeeId: r.id, shiftId: probe.id });
    if (ev.outcome === "ok") out.push(r.id);
    if (out.length === count) break;
  }
  await db.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, probe.id));
  return out;
}

const notesFor = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));

beforeAll(async () => {
  ({ db, orgId } = await demoDb());
  [corp, scheduler, don] = await Promise.all([actorFor(db, "corporate@demo.test"), actorFor(db, "scheduler@demo.test"), actorFor(db, "don@demo.test")]);
  mgr = await facilityByCode(db, "MGR");
  crk = await facilityByCode(db, "CRK");
  const ids = await cleanEmployees(mgr, "CNA", 4);
  expect(ids.length).toBe(4);
  for (const [i, id] of ids.entries()) people.push(await employeeUser(id, `cna${i}@demo.test`));
  const [rn] = await cleanEmployees(mgr, "RN", 1);
  rnAtMgr = await employeeUser(rn, "rn-mgr@demo.test");
  const [crkCna] = await cleanEmployees(crk, "CNA", 1);
  cnaAtCrk = await employeeUser(crkCna, "cna-crk@demo.test");
});

describe("publishing open shifts", () => {
  it("publishes single and bulk, skips shifts that are full or already listed, and respects facility scope", async () => {
    const a = await newShift(mgr, day(1), "07:00", 8, 2);
    const b = await newShift(mgr, day(2));
    const full = await newShift(mgr, day(3));
    await assignEmployee(db, corp, ctxFor(corp), { shiftId: full.id, employeeId: people[3].employeeId! });

    const r1 = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [a.id] });
    expect(r1.published).toBe(1);
    const r2 = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [a.id, b.id, full.id] });
    expect(r2.published).toBe(1);
    expect(r2.skipped.map((s) => s.reason).sort()).toEqual(["The shift is already fully staffed.", "The shift is already listed."]);

    const [la] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.shiftId, a.id));
    expect(la.openings).toBe(2);
    // Default closing time: 2 hours before the shift.
    expect(a.startsAt.getTime() - la.expiresAt!.getTime()).toBe(2 * 3_600_000);

    // The MGR scheduler can't publish Cedar Ridge shifts.
    const c = await newShift(crk, day(1));
    await expect(publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [c.id] })).rejects.toThrow(/permission/);

    // Qualified MGR CNAs were notified, once each, in the app.
    const n = await notesFor(people[0].userId);
    expect(n.filter((x) => x.category === "open_shift").length).toBe(2);
    expect((await notesFor(rnAtMgr.userId)).filter((x) => x.category === "open_shift").length).toBe(0);
  });

  it("lists unfilled shifts with their listing status for the staff page", async () => {
    const rows = await unfilledShifts(db, scheduler, mgr.id, 60);
    expect(rows.some((r) => r.listing === "open")).toBe(true);
    expect(rows.every((r) => r.open > 0)).toBe(true);
  });
});

describe("Pick Up tab and one-tap claims", () => {
  it("shows a listing only to qualified, authorized employees", async () => {
    const s = await newShift(mgr, day(4));
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id] });
    const seen = async (a: Actor) => (await openShiftsForMe(db, a)).available.some((x) => x.listingId === listingIds[0]);
    expect(await seen(people[0])).toBe(true);
    expect(await seen(rnAtMgr)).toBe(false); // wrong position
    expect(await seen(cnaAtCrk)).toBe(false); // not authorized at MGR
    await expect(claimShift(db, cnaAtCrk, ctxFor(cnaAtCrk), listingIds[0])).rejects.toThrow(/not found/);
  });

  it("claims instantly when the rules allow, and the listing becomes filled", async () => {
    const s = await newShift(mgr, day(5));
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id] });
    const r = await claimShift(db, people[0], ctxFor(people[0]), listingIds[0]);
    expect(r.status).toBe("assigned");
    const [a] = await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, s.id), eq(shiftAssignments.status, "assigned")));
    expect(a.employeeId).toBe(people[0].employeeId);
    expect(a.assignedVia).toBe("marketplace");
    const [l] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, listingIds[0]));
    expect(l.status).toBe("filled");
    const [c] = await db.select().from(shiftClaims).where(eq(shiftClaims.id, r.claimId!));
    expect(c.status).toBe("auto_approved");
    expect(c.assignmentId).toBe(a.id);
  });

  it("two people tapping the last opening at once: exactly one wins, the other can join the waitlist and is offered a freed spot", async () => {
    const s = await newShift(mgr, day(6), "15:00");
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id] });
    const results = await Promise.all([claimShift(db, people[1], ctxFor(people[1]), listingIds[0]), claimShift(db, people[2], ctxFor(people[2]), listingIds[0])]);
    expect(results.map((r) => r.status).sort()).toEqual(["assigned", "full"]);
    const assigned = await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, s.id), eq(shiftAssignments.status, "assigned")));
    expect(assigned.length).toBe(1);

    const loser = results[0].status === "full" ? people[1] : people[2];
    await joinWaitlist(db, loser, ctxFor(loser), listingIds[0]);
    await joinWaitlist(db, loser, ctxFor(loser), listingIds[0]); // idempotent
    expect((await openShiftsForMe(db, loser)).full.find((f) => f.listingId === listingIds[0])?.onWaitlist).toBe("waiting");

    // The scheduler removes the winner: the listing reopens and the waitlist is offered the spot.
    await unassign(db, scheduler, ctxFor(scheduler), assigned[0].id, "Moved to another unit");
    const [l] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, listingIds[0]));
    expect(l.status).toBe("open");
    const [w] = await db.select().from(shiftWaitlists).where(and(eq(shiftWaitlists.shiftId, s.id), eq(shiftWaitlists.employeeId, loser.employeeId!)));
    expect(w.status).toBe("offered");
    expect((await notesFor(loser.userId)).some((n) => n.category === "waitlist_offer")).toBe(true);
    const again = await claimShift(db, loser, ctxFor(loser), listingIds[0]);
    expect(again.status).toBe("assigned");
    const [w2] = await db.select().from(shiftWaitlists).where(eq(shiftWaitlists.id, w.id));
    expect(w2.status).toBe("claimed");
  });

  it("hides shifts the employee can't legally take (e.g. overlapping one they already have)", async () => {
    const mine = await newShift(mgr, day(8), "07:00");
    await assignEmployee(db, corp, ctxFor(corp), { shiftId: mine.id, employeeId: people[3].employeeId! });
    const clash = await newShift(mgr, day(8), "11:00");
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [clash.id] });
    expect((await openShiftsForMe(db, people[3])).available.some((x) => x.listingId === listingIds[0])).toBe(false);
    const r = await claimShift(db, people[3], ctxFor(people[3]), listingIds[0]);
    expect(r.status).toBe("blocked");
    expect(r.message).toMatch(/Overlaps/);
  });
});

describe("claim approvals", () => {
  it("an overtime claim waits for an approver with permission and an explanation; the override is recorded", async () => {
    const emp = people[2];
    // Five 8-hour shifts Mon-Fri of the next week = 40 hours, then claim a sixth.
    const base = addDaysStr(WEEK, 7);
    for (let i = 1; i <= 5; i++) {
      const s = await newShift(mgr, addDaysStr(base, i), "07:00");
      const r = await assignEmployee(db, corp, ctxFor(corp), { shiftId: s.id, employeeId: emp.employeeId! });
      expect(r.status).toBe("assigned");
    }
    const sat = await newShift(mgr, addDaysStr(base, 6), "07:00");
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [sat.id] });
    const card = (await openShiftsForMe(db, emp)).available.find((x) => x.listingId === listingIds[0]);
    expect(card?.mode).toBe("review");
    expect(card?.reasons.join(" ")).toMatch(/overtime/i);

    const r = await claimShift(db, emp, ctxFor(emp), listingIds[0]);
    expect(r.status).toBe("pending");
    expect((await notesFor(scheduler.userId)).some((n) => n.category === "claim_review")).toBe(true);
    const view = await facilityMarketplace(db, scheduler, mgr.id);
    expect(view.claims.some((c) => c.claim.id === r.claimId)).toBe(true);

    // The scheduler can review claims but can't approve overtime.
    const s1 = await reviewClaim(db, scheduler, ctxFor(scheduler), r.claimId!, true, "");
    expect(s1).toMatchObject({ ok: false, needs: "approval_permission" });
    // The DON can, but only with an explanation.
    const s2 = await reviewClaim(db, don, ctxFor(don), r.claimId!, true, "");
    expect(s2).toMatchObject({ ok: false, needs: "explanation" });
    const s3 = await reviewClaim(db, don, ctxFor(don), r.claimId!, true, "Short-staffed for the state survey");
    expect(s3.ok).toBe(true);
    const [c] = await db.select().from(shiftClaims).where(eq(shiftClaims.id, r.claimId!));
    expect(c.status).toBe("approved");
    const ov = await db.select().from(ruleOverrides).where(eq(ruleOverrides.subjectId, c.assignmentId!));
    expect(ov.map((o) => o.ruleType)).toContain("overtime");
    expect(ov[0].explanation).toBe("Short-staffed for the state survey");
    expect((await notesFor(emp.userId)).some((n) => n.title === "Shift approved")).toBe(true);
  });

  it("'requires approval' listings always go to review; decline notifies; withdrawing cancels pending claims", async () => {
    const s = await newShift(mgr, day(9), "07:00", 8, 2);
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id], requiresApproval: true, incentiveText: "$5/hr bonus" });
    const a = await claimShift(db, people[0], ctxFor(people[0]), listingIds[0]);
    const b = await claimShift(db, people[1], ctxFor(people[1]), listingIds[0]);
    expect([a.status, b.status]).toEqual(["pending", "pending"]);
    await expect(claimShift(db, people[0], ctxFor(people[0]), listingIds[0])).rejects.toThrow(/not found|already/);
    const d = await reviewClaim(db, scheduler, ctxFor(scheduler), a.claimId!, false, "Need someone with wound care experience");
    expect(d.ok).toBe(true);
    expect((await notesFor(people[0].userId)).some((n) => n.title === "Pick-up request declined" && n.body.includes("wound care"))).toBe(true);
    await withdrawListing(db, scheduler, ctxFor(scheduler), listingIds[0], "Agency nurse booked");
    const [cb] = await db.select().from(shiftClaims).where(eq(shiftClaims.id, b.claimId!));
    expect(cb.status).toBe("cancelled");
    expect((await notesFor(people[1].userId)).some((n) => n.title === "Open shift withdrawn")).toBe(true);
  });

  it("an employee can withdraw their own pending request", async () => {
    const s = await newShift(mgr, day(10));
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id], requiresApproval: true });
    const r = await claimShift(db, people[1], ctxFor(people[1]), listingIds[0]);
    await expect(withdrawClaim(db, people[0], ctxFor(people[0]), r.claimId!)).rejects.toThrow(/not found/);
    await withdrawClaim(db, people[1], ctxFor(people[1]), r.claimId!);
    const [c] = await db.select().from(shiftClaims).where(eq(shiftClaims.id, r.claimId!));
    expect(c.status).toBe("withdrawn");
  });
});

describe("scheduled, expiring and automatic publishing", () => {
  it("a scheduled listing stays hidden until its time, then opens; a listing past its closing time expires and cancels pending claims", async () => {
    const s = await newShift(mgr, day(11));
    const publishAt = new Date(Date.now() + 2 * 86_400_000);
    const r = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id], publishAt, requiresApproval: true });
    expect(r.scheduled).toBe(1);
    expect((await openShiftsForMe(db, people[0])).available.some((x) => x.listingId === r.listingIds[0])).toBe(false);
    await runMarketplaceJobs(db, new Date(publishAt.getTime() + 60_000));
    let [l] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, r.listingIds[0]));
    expect(l.status).toBe("open");
    const claim = await claimShift(db, people[0], ctxFor(people[0]), l.id, new Date(publishAt.getTime() + 120_000));
    expect(claim.status).toBe("pending");
    await runMarketplaceJobs(db, new Date(l.expiresAt!.getTime() + 60_000));
    [l] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, l.id));
    expect(l.status).toBe("expired");
    const [c] = await db.select().from(shiftClaims).where(eq(shiftClaims.id, claim.claimId!));
    expect(c.status).toBe("cancelled");
  });

  it("auto-publishes unfilled shifts of published schedules inside the lead time, once", async () => {
    await saveMarketplaceSettings(db, corp, ctxFor(corp), crk.id, { autoPublish: true, autoPublishHoursBefore: 48, expiryHoursBefore: 1, requireApproval: false, escalationMinutes: [30, 60] });
    expect((await marketplaceConfig(db, orgId, crk.id)).source).toBe("facility");
    expect((await marketplaceConfig(db, orgId, mgr.id)).source).toBe("default");
    const wk = addDaysStr(WEEK, 70);
    const [sch] = await db.insert(schedules).values({ facilityId: crk.id, periodStart: wk, periodEnd: addDaysStr(wk, 6), status: "published" }).returning();
    const [draft] = await db.insert(schedules).values({ facilityId: crk.id, periodStart: addDaysStr(wk, 7), periodEnd: addDaysStr(wk, 13), status: "draft" }).returning();
    const s1 = await newShift(crk, addDaysStr(wk, 1));
    const s2 = await newShift(crk, addDaysStr(wk, 5)); // outside the 48h window
    const s3 = await newShift(crk, addDaysStr(wk, 8)); // draft schedule
    await db.update(shifts).set({ scheduleId: sch.id }).where(inArray(shifts.id, [s1.id, s2.id]));
    await db.update(shifts).set({ scheduleId: draft.id }).where(eq(shifts.id, s3.id));
    const now = new Date(s1.startsAt.getTime() - 24 * 3_600_000);
    const r = await runMarketplaceJobs(db, now);
    expect(r.autoPublished).toBe(1);
    const ls = await db.select().from(marketplaceListings).where(inArray(marketplaceListings.shiftId, [s1.id, s2.id, s3.id]));
    expect(ls.map((l) => l.shiftId)).toEqual([s1.id]);
    expect((await runMarketplaceJobs(db, now)).autoPublished).toBe(0);
    // Withdrawn listings are not re-published automatically.
    await withdrawListing(db, corp, ctxFor(corp), ls[0].id);
    expect((await runMarketplaceJobs(db, now)).autoPublished).toBe(0);
  });
});

describe("shift swaps", () => {
  it("peer accepts, a manager approves, and both schedules change atomically", async () => {
    const [A, B] = [people[0], people[1]];
    const sa = await newShift(mgr, addDaysStr(WEEK, 14 + 2), "07:00");
    const sb = await newShift(mgr, addDaysStr(WEEK, 14 + 3), "15:00");
    const aa = await assignEmployee(db, corp, ctxFor(corp), { shiftId: sa.id, employeeId: A.employeeId! });
    const ab = await assignEmployee(db, corp, ctxFor(corp), { shiftId: sb.id, employeeId: B.employeeId! });
    const opts = await swapOptions(db, A, aa.assignmentId!);
    expect(opts.options.some((o) => o.id === ab.assignmentId)).toBe(true);
    expect(opts.options[0].name).toMatch(/^\S+ \S\.$/); // first name + last initial only

    const { swapId } = await requestSwap(db, A, ctxFor(A), { myAssignmentId: aa.assignmentId!, targetAssignmentId: ab.assignmentId!, note: "Family event" });
    await expect(requestSwap(db, A, ctxFor(A), { myAssignmentId: aa.assignmentId!, targetAssignmentId: ab.assignmentId! })).rejects.toThrow(/already has a swap/);
    expect((await mySwaps(db, B)).find((s) => s.id === swapId)?.incoming).toBe(true);
    await respondToSwap(db, B, ctxFor(B), swapId, true);

    await expect(decideSwap(db, scheduler, ctxFor(scheduler), swapId, true, "")).rejects.toThrow(/permission/);
    const d = await decideSwap(db, don, ctxFor(don), swapId, true, "");
    expect(d.ok).toBe(true);
    const rows = await db.select().from(shiftAssignments).where(inArray(shiftAssignments.shiftId, [sa.id, sb.id]));
    const active = rows.filter((r) => r.status === "assigned");
    expect(active.find((r) => r.shiftId === sa.id)?.employeeId).toBe(B.employeeId);
    expect(active.find((r) => r.shiftId === sb.id)?.employeeId).toBe(A.employeeId);
    expect(rows.filter((r) => r.status === "swapped_out").length).toBe(2);
    expect(active.every((r) => r.assignedVia === "swap")).toBe(true);
  });

  it("refuses a swap the rules engine can't allow", async () => {
    const [A, B] = [people[0], people[3]];
    const sa = await newShift(mgr, addDaysStr(WEEK, 14 + 5), "07:00");
    const sb = await newShift(mgr, addDaysStr(WEEK, 14 + 6), "07:00");
    const blocker = await newShift(mgr, addDaysStr(WEEK, 14 + 6), "09:00"); // A already works over B's shift
    const aa = await assignEmployee(db, corp, ctxFor(corp), { shiftId: sa.id, employeeId: A.employeeId! });
    const ab = await assignEmployee(db, corp, ctxFor(corp), { shiftId: sb.id, employeeId: B.employeeId! });
    await assignEmployee(db, corp, ctxFor(corp), { shiftId: blocker.id, employeeId: A.employeeId! });
    await expect(requestSwap(db, A, ctxFor(A), { myAssignmentId: aa.assignmentId!, targetAssignmentId: ab.assignmentId! })).rejects.toThrow(/isn't possible.*Overlaps/);
  });
});

describe("callouts and escalation", () => {
  it("a self-reported callout posts the shift urgently, alerts managers, escalates on schedule, and closes when covered", async () => {
    const caller = people[3];
    const s = await newShift(mgr, addDaysStr(WEEK, 28 + 2), "07:00");
    const a = await assignEmployee(db, corp, ctxFor(corp), { shiftId: s.id, employeeId: caller.employeeId! });
    // Someone else can't call out on your behalf without callouts.manage.
    await expect(recordCallout(db, people[0], ctxFor(people[0]), a.assignmentId!, "sick")).rejects.toThrow(/permission/);

    const t0 = new Date();
    const r = await recordCallout(db, caller, ctxFor(caller), a.assignmentId!, "Sick child", t0);
    const [asg] = await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, a.assignmentId!));
    expect(asg.status).toBe("called_out");
    const [l] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, r.listingId!));
    expect(l.status).toBe("open");
    expect(l.audience).toEqual({ scope: "home" });
    expect(l.expiresAt?.getTime()).toBe(s.startsAt.getTime());
    expect((await notesFor(scheduler.userId)).some((n) => n.category === "callout")).toBe(true);
    expect((await notesFor(people[0].userId)).some((n) => n.category === "callout_coverage")).toBe(true);
    expect(r.notified).toBeGreaterThan(0);

    expect((await escalateCallouts(db, new Date(t0.getTime() + 10 * 60_000))).escalated).toBe(0);
    expect((await escalateCallouts(db, new Date(t0.getTime() + 31 * 60_000))).escalated).toBe(1);
    let [co] = await db.select().from(callouts).where(eq(callouts.id, r.calloutId));
    expect(co.escalationLevel).toBe(1);
    const [l1] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, r.listingId!));
    expect(l1.audience).toEqual({ scope: "authorized" });
    expect((await escalateCallouts(db, new Date(t0.getTime() + 60 * 60_000))).escalated).toBe(0); // 60 min after level 1 not yet
    expect((await escalateCallouts(db, new Date(t0.getTime() + 92 * 60_000))).escalated).toBe(1);
    [co] = await db.select().from(callouts).where(eq(callouts.id, r.calloutId));
    expect(co.escalationLevel).toBe(2);
    expect((await notesFor(don.userId)).some((n) => n.title === "Callout still uncovered")).toBe(true);

    const claim = await claimShift(db, people[1], ctxFor(people[1]), r.listingId!);
    expect(claim.status).toBe("assigned");
    [co] = await db.select().from(callouts).where(eq(callouts.id, r.calloutId));
    expect(co.status).toBe("covered");
  });

  it("a manager records a callout with a reason; an uncovered callout closes when the shift starts", async () => {
    const s = await newShift(mgr, addDaysStr(WEEK, 28 + 4), "07:00");
    const a = await assignEmployee(db, corp, ctxFor(corp), { shiftId: s.id, employeeId: people[0].employeeId! });
    await expect(recordCallout(db, scheduler, ctxFor(scheduler), a.assignmentId!, "")).rejects.toThrow(/reason/);
    const r = await recordCallout(db, scheduler, ctxFor(scheduler), a.assignmentId!, "Called at 5am, flu");
    const res = await escalateCallouts(db, new Date(s.startsAt.getTime() + 60_000));
    expect(res.uncovered).toBe(1);
    const [co] = await db.select().from(callouts).where(eq(callouts.id, r.calloutId));
    expect(co.status).toBe("uncovered");
  });
});
