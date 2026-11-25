import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { log } from "@/server/log";
import { runMarketplaceJobs } from "@/server/marketplace/jobs";

/**
 * Marketplace background job: opens scheduled listings, expires old ones,
 * auto-publishes, escalates callouts, delivers queued notifications.
 * Protected by CRON_SECRET ("Authorization: Bearer <secret>").
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runMarketplaceJobs(await getDb());
  log.info("cron.marketplace", result);
  return NextResponse.json(result);
}
