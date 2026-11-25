/**
 * Concurrency load tests. Real PostgreSQL only (TEST_DATABASE_URL), where
 * transactions genuinely run in parallel on separate connections.
 */
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLogs, callouts, employeePositions, employees, marketplaceListings, notifications, positions, roles, shiftAssignments, shifts, userRoles, users } from "@/db/schema";
import { escalateCallouts, recordCallout } from "@/server/marketplace/callouts";
import { claimShift } from "@/server/marketplace/claims";
import { runMarketplaceJobs } from "@/server/marketplace/jobs";
import { publishOpenShifts } from "@/server/marketplace/listings";
import { clearProviders, deliverPending, notify, registerProvider } from "@/server/notifications";
import { loadActor, type Actor } from "@/server/rbac/access";
import { assignEmployee } from "@/server/scheduling/assignments";
import { evaluateAssignment } from "@/server/scheduling/rules";
import { actorFor, ctxFor, demoDb, facilityByCode } from "./helpers";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let db: Db;
let orgId: string;
let corp: Actor, scheduler: Actor;
let mgr: { id: string; timezone: string };
const people: Actor[] = [];

async function newShift(daysAhead: number, hour: number, required = 1) {
  const [p] = await db.select().from(positions).where(and(eq(positions.organizationId, orgId), eq(positions.code, "CNA")));
  const startsAt = new Date(Date.now() + daysAhead * 86_400_000);
  startsAt.setUTCHours(hour, 0, 0, 0);
  const [s] = await db.insert(shifts).values({ facilityId: mgr.id, positionId: p.id, workDate: startsAt.toISOString().slice(0, 10), startsAt, endsAt: new Date(startsAt.getTime() + 8 * 3_600_000), paidHours: "8", requiredCount: required, source: "manual" }).returning();
  return s;
}

d("concurrency under load (real PostgreSQL)", () => {
  beforeAll(async () => {
    ({ db, orgId } = await demoDb());
    [corp, scheduler] = await Promise.all([actorFor(db, "corporate@demo.test"), actorFor(db, "scheduler@demo.test")]);
    mgr = await facilityByCode(db, "MGR");
    // Employee app logins for every MGR CNA whose pick-up would be clean.
    const [role] = await db.select().from(roles).where(and(eq(roles.organizationId, orgId), eq(roles.key, "employee")));
    const linked = new Set((await db.select({ e: users.employeeId }).from(users)).map((u) => u.e));
    const cnas = await db
      .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
      .from(employees)
      .innerJoin(employeePositions, eq(employeePositions.employeeId, employees.id))
      .innerJoin(positions, eq(positions.id, employeePositions.positionId))
      .where(and(eq(employees.homeFacilityId, mgr.id), eq(employees.employmentStatus, "active"), eq(positions.code, "CNA")));
    const probe = await newShift(30, 12, 99);
    for (const [i, c] of cnas.entries()) {
      if (linked.has(c.id)) continue;
      if ((await evaluateAssignment(db, { employeeId: c.id, shiftId: probe.id })).outcome !== "ok") continue;
      const [u] = await db.insert(users).values({ organizationId: orgId, email: `load${i}@demo.test`, displayName: `${c.first} ${c.last}`, passwordHash: "x", status: "active", employeeId: c.id, isDemo: true }).returning();
      await db.insert(userRoles).values({ userId: u.id, roleId: role.id, scopeType: "organization" });
      people.push((await loadActor(db, u.id))!);
    }
    await db.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, probe.id));
    expect(people.length).toBeGreaterThanOrEqual(8);
  });

  it("everyone taps 'Pick up' on 3 openings at the same instant: exactly 3 win, the rest are told it's full", async () => {
    const s = await newShift(10, 12, 3);
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id] });
    const t0 = Date.now();
    const results = await Promise.all(people.map((p) => claimShift(db, p, ctxFor(p), listingIds[0]).catch((e) => ({ status: "error", message: String(e) }))));
    const ms = Date.now() - t0;
    const won = results.filter((r) => r.status === "assigned").length;
    expect(won).toBe(3);
    expect(results.filter((r) => r.status === "error")).toEqual([]);
    expect(results.filter((r) => r.status === "full").length).toBe(people.length - 3);
    const rows = await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, s.id), eq(shiftAssignments.status, "assigned")));
    expect(rows.length).toBe(3);
    const [l] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, listingIds[0]));
    expect(l.status).toBe("filled");
    console.info(`[load] ${people.length} simultaneous claims for 3 openings resolved in ${ms} ms`);
  });

  it("one person can never be double-booked, even with 20 simultaneous assignments to overlapping shifts", async () => {
    const who = people[people.length - 1].employeeId!;
    const list = await Promise.all(Array.from({ length: 20 }, (_, i) => newShift(12, 6 + (i % 4), 1)));
    const results = await Promise.all(list.map((s) => assignEmployee(db, corp, ctxFor(corp), { shiftId: s.id, employeeId: who, explanation: "load test" }).catch((e) => ({ status: "refused", message: String(e) }))));
    expect(results.filter((r) => r.status === "assigned").length).toBe(1);
    const active = await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.employeeId, who), eq(shiftAssignments.status, "assigned"), inArray(shiftAssignments.shiftId, list.map((s) => s.id))));
    expect(active.length).toBe(1);
  });

  it("a burst of 200 claims across 40 shifts never overfills any shift", async () => {
    const list = await Promise.all(Array.from({ length: 40 }, (_, i) => newShift(14 + Math.floor(i / 4), (i % 4) * 6, 2)));
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: list.map((s) => s.id) });
    const t0 = Date.now();
    const jobs = Array.from({ length: 200 }, (_, i) => ({ p: people[i % people.length], l: listingIds[i % listingIds.length] }));
    await Promise.all(jobs.map((j) => claimShift(db, j.p, ctxFor(j.p), j.l).catch(() => null)));
    const ms = Date.now() - t0;
    for (const s of list) {
      const n = (await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.shiftId, s.id), eq(shiftAssignments.status, "assigned")))).length;
      expect(n).toBeLessThanOrEqual(2);
    }
    // Nobody ends up in two overlapping shifts (the database exclusion constraint).
    const all = await db.select().from(shiftAssignments).where(and(inArray(shiftAssignments.shiftId, list.map((s) => s.id)), eq(shiftAssignments.status, "assigned")));
    for (const a of all) for (const b of all) if (a.id !== b.id && a.employeeId === b.employeeId) expect(a.startsAt < b.endsAt && b.startsAt < a.endsAt).toBe(false);
    console.info(`[load] 200 concurrent claims across 40 shifts in ${ms} ms (${Math.round(200000 / Math.max(1, ms))} claims/s)`);
  });

  it("the background job running on five servers at once escalates a callout exactly once", async () => {
    const s = await newShift(20, 12, 1);
    const a = await assignEmployee(db, corp, ctxFor(corp), { shiftId: s.id, employeeId: people[0].employeeId!, explanation: "Load test: approved" });
    expect(a.status).toBe("assigned");
    const t0 = new Date();
    const c = await recordCallout(db, scheduler, ctxFor(scheduler), a.assignmentId!, "Flu (load test)", t0);
    const later = new Date(t0.getTime() + 31 * 60_000);
    await Promise.all(Array.from({ length: 5 }, () => escalateCallouts(db, later)));
    const [row] = await db.select().from(callouts).where(eq(callouts.id, c.calloutId));
    expect(row.escalationLevel).toBe(1);
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "callout.escalated"), eq(auditLogs.entityId, c.calloutId)));
    expect(logs.length).toBe(1);
    // And the full job is safe to overlap too.
    await Promise.all(Array.from({ length: 3 }, () => runMarketplaceJobs(db, new Date(t0.getTime() + 95 * 60_000))));
    const [row2] = await db.select().from(callouts).where(eq(callouts.id, c.calloutId));
    expect(row2.escalationLevel).toBe(2);
    expect((await db.select().from(auditLogs).where(and(eq(auditLogs.action, "callout.escalated"), eq(auditLogs.entityId, c.calloutId)))).length).toBe(2);
  });

  it("five servers delivering email at once send each message exactly once", async () => {
    const sent: string[] = [];
    registerProvider({ channel: "email", name: "counting", async send(to, m) { await new Promise((r) => setTimeout(r, 5)); sent.push(`${to.userId}:${m.title}`); } });
    try {
      await notify(db, { organizationId: orgId, userIds: people.map((p) => p.userId), category: "open_shift", title: "Load test", body: "x" });
      await Promise.all(Array.from({ length: 5 }, () => deliverPending(db)));
      expect(sent.filter((x) => x.endsWith(":Load test")).length).toBe(people.length);
      expect(new Set(sent).size).toBe(sent.length);
      const left = await db.select().from(notifications).where(and(eq(notifications.channel, "email"), eq(notifications.status, "pending")));
      expect(left.length).toBe(0);
    } finally {
      clearProviders();
    }
  });
});
