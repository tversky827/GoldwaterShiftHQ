/**
 * Database connection.
 *
 *  - DATABASE_URL set  -> managed PostgreSQL (production/staging) via node-postgres.
 *  - DATABASE_URL unset -> embedded PostgreSQL (PGlite) stored in ./data/pglite,
 *    migrated automatically. Lets the app run locally with nothing to install.
 *
 * In production, run `npm run db:migrate` during deploy instead of auto-migrating.
 */
import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

const g = globalThis as unknown as { __gshqDb?: Promise<Db> };

async function create(url = process.env.DATABASE_URL): Promise<Db> {
  if (url && !url.startsWith("pglite:") && !url.startsWith("memory:")) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    return drizzle(pool, { schema, casing: "snake_case" }) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = url?.startsWith("memory:")
    ? "memory://"
    : url?.startsWith("pglite:")
      ? url.slice(7)
      : path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "pglite");
  if (!dataDir.startsWith("memory://")) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = new PGlite({ dataDir, extensions: { btree_gist } });
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!g.__gshqDb) g.__gshqDb = create();
  return g.__gshqDb;
}

/** Tests: a fresh, isolated in-memory database with all migrations applied. */
export async function createTestDb(): Promise<Db> {
  return create("memory:");
}

/** Tests: route getDb() to a specific instance. */
export function setDbForTests(db: Db) {
  g.__gshqDb = Promise.resolve(db);
}
