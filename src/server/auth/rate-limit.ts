import { sql } from "drizzle-orm";
import type { Db } from "@/db";

/**
 * Fixed-window rate limiter stored in Postgres, so it works across serverless
 * instances. Returns true when the action is allowed.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const res = await db.execute(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`);
  const rows = (res as unknown as { rows: { count: number }[] }).rows;
  return Number(rows[0]?.count ?? 0) <= limit;
}
