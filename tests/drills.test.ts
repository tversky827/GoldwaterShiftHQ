/**
 * Failure drills: things break on purpose, and the app must fail safely.
 */
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setDbForTests, type Db } from "@/db";
import { integrationConnections, integrationSyncLogs, marketplaceListings, notifications, shifts, timekeepingRecords } from "@/db/schema";
import { syncAodTimekeeping } from "@/server/integrations/aod/sync";
import type { AodSource } from "@/server/integrations/aod/types";
import { publishOpenShifts } from "@/server/marketplace/listings";
import { clearProviders, notify, registerProvider } from "@/server/notifications";
import type { Actor } from "@/server/rbac/access";
import { actorFor, ctxFor, demoDb, facilityByCode, makeShift } from "./helpers";

// Drill 3 makes callout escalation crash; everything else in the job must still run.
const boom = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/marketplace/callouts", async (orig) => {
  const real = await orig<typeof import("@/server/marketplace/callouts")>();
  return { ...real, escalateCallouts: async (...a: Parameters<typeof real.escalateCallouts>) => (boom.on ? Promise.reject(new Error("simulated crash")) : real.escalateCallouts(...a)) };
});

let db: Db;
let orgId: string;
let scheduler: Actor;

beforeAll(async () => {
  ({ db, orgId } = await demoDb());
  scheduler = await actorFor(db, "scheduler@demo.test");
});
afterAll(() => clearProviders());

describe("failure drills", () => {
  it("Attendance on Demand goes down mid-sync: no timekeeping changes, failure recorded, dashboard shows 'needs attention'", async () => {
    const before = (await db.select({ n: count() }).from(timekeepingRecords))[0].n;
    const failing: AodSource = {
      label: "AOD (drill)",
      isDemo: true,
      testConnection: async () => ({ ok: false, message: "down" }),
      fetchEmployees: async () => [],
      fetchAttendance: async () => {
        throw new Error("ECONNRESET: socket hang up");
      },
    };
    const out = await syncAodTimekeeping(db, { organizationId: orgId, source: failing, trigger: "manual" });
    expect(out.ok).toBe(false);
    expect((await db.select({ n: count() }).from(timekeepingRecords))[0].n).toBe(before);
    const [log] = await db.select().from(integrationSyncLogs).where(eq(integrationSyncLogs.id, (out as { syncLogId: string }).syncLogId));
    expect(log.status).toBe("failed");
    expect(log.errorSummary).toMatch(/ECONNRESET/);
    const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.provider, "aod"));
    expect(conn.status).toBe("needs_attention");
  });

  it("punches at facilities listed in AOD_IGNORE_FACILITIES are skipped, others imported", async () => {
    vi.stubEnv("AOD_IGNORE_FACILITIES", " Estates of Clinton ,Other Place");
    const rec = (id: string, facility: string) => ({ id, aodEmployeeKey: "999001", facility, workDate: "2026-11-20", punchIn: "2026-11-20T12:00:00.000Z", punchOut: "2026-11-20T20:00:00.000Z", hours: 8, isMock: true });
    const src: AodSource = {
      label: "AOD (ignore test)",
      isDemo: true,
      testConnection: async () => ({ ok: true, message: "ok" }),
      fetchEmployees: async () => [],
      fetchAttendance: async () => [rec("ign-1", "estates of clinton"), rec("ign-2", "Maple Grove")],
    };
    try {
      const out = await syncAodTimekeeping(db, { organizationId: orgId, source: src, trigger: "manual" });
      expect(out.ok).toBe(true);
      const ids = (await db.select({ id: timekeepingRecords.externalId }).from(timekeepingRecords)).map((r) => r.id);
      expect(ids).toContain("ign-2");
      expect(ids).not.toContain("ign-1");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("the database is unreachable: the health check says so (503) without leaking details", async () => {
    const { GET } = await import("@/app/api/health/route");
    setDbForTests({ execute: async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"); } } as unknown as Db);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|hunter2/);
    setDbForTests(db);
    expect((await GET()).status).toBe(200);
  });

  it("one background step crashes: it's reported, and the other steps (opening listings, sending email) still run", async () => {
    const { runMarketplaceJobs } = await import("@/server/marketplace/jobs");
    const mgr = await facilityByCode(db, "MGR");
    const s = await makeShift(db, orgId, mgr.id, new Date(Date.now() + 9 * 86_400_000).toISOString());
    const publishAt = new Date(Date.now() + 60_000);
    const { listingIds } = await publishOpenShifts(db, scheduler, ctxFor(scheduler), { shiftIds: [s.id], publishAt });
    const sent: string[] = [];
    registerProvider({ channel: "email", name: "drill", async send(_to, m) { sent.push(m.title); } });
    await notify(db, { organizationId: orgId, userIds: [scheduler.userId], category: "claim_review", title: "Drill email", body: "x" });
    boom.on = true;
    try {
      const r = await runMarketplaceJobs(db, new Date(publishAt.getTime() + 1000));
      expect(r.errors).toEqual(["callouts"]);
      expect(r.opened).toBeGreaterThanOrEqual(1);
      expect(sent).toContain("Drill email");
    } finally {
      boom.on = false;
    }
    const [l] = await db.select().from(marketplaceListings).where(eq(marketplaceListings.id, listingIds[0]));
    expect(l.status).toBe("open");
    const pending = await db.select().from(notifications).where(eq(notifications.status, "pending"));
    expect(pending.filter((p) => p.title === "Drill email")).toEqual([]);
    await db.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, s.id));
  });
});
