import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";

/**
 * Uptime check for monitoring services: 200 when the app and its database
 * answer, 503 otherwise. Public and deliberately uninformative (no versions,
 * no counts, no error details).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    await Promise.race([db.execute(sql`select 1`), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))]);
    return NextResponse.json({ status: "ok", database: "ok", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
