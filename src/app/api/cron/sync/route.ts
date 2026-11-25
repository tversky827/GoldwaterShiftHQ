import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";
import { runSync } from "@/server/integrations";
import { log } from "@/server/log";

/**
 * Scheduled synchronization (Vercel Cron, see vercel.json).
 * Protected by CRON_SECRET; Vercel sends it as "Authorization: Bearer <secret>".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  const results = [];
  for (const o of orgs) {
    for (const provider of ["paycor", "aod"] as const) {
      const r = await runSync(db, provider, { organizationId: o.id, trigger: "scheduled" });
      results.push({ organizationId: o.id, provider, ok: r.ok });
      log.info("cron.sync", { organizationId: o.id, provider, ok: r.ok });
    }
  }
  return NextResponse.json({ results });
}
