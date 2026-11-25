import "server-only";
/**
 * Runs the marketplace job in the background while people use the app, so
 * nothing depends on the hosting plan's scheduler. At most once every two
 * minutes per server; it runs after the page has been sent, so nobody waits.
 * The hosted scheduler (/api/cron/marketplace) is still used when available,
 * e.g. overnight when nobody is signed in. Every step is safe to run twice.
 */
import { after } from "next/server";
import { getDb } from "@/db";
import { log } from "../log";
import { runMarketplaceJobs } from "./jobs";

const EVERY_MS = 2 * 60_000;
const g = globalThis as unknown as { __gshqJobsAt?: number; __gshqJobsRunning?: boolean };

export function kickBackgroundJobs() {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  const now = Date.now();
  if (g.__gshqJobsRunning || now - (g.__gshqJobsAt ?? 0) < EVERY_MS) return;
  g.__gshqJobsAt = now;
  after(async () => {
    g.__gshqJobsRunning = true;
    try {
      const r = await runMarketplaceJobs(await getDb());
      if (r.opened || r.expired || r.autoPublished || r.callouts.escalated || r.delivered.sent || r.delivered.failed) log.info("jobs.background", r);
    } catch (e) {
      log.error("jobs.background_failed", { message: (e as Error)?.message });
    } finally {
      g.__gshqJobsRunning = false;
    }
  });
}
