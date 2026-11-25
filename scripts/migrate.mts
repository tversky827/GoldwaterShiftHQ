/** Apply database migrations to DATABASE_URL (production) or the local embedded DB. */
import path from "node:path";
const url = process.env.DATABASE_URL;
if (url && !url.startsWith("pglite:") && !url.startsWith("memory:")) {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await pool.end();
} else {
  const { getDb } = await import("../src/db/index.ts");
  await getDb();
}
console.log("Migrations applied.");
