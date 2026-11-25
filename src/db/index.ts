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

/**
 * Tests: a fresh, isolated database with all migrations applied.
 * Default: in-memory PGlite. With TEST_DATABASE_URL (a real PostgreSQL server
 * where the user may create databases), each call creates a brand-new database
 * there, so the same tests also prove behaviour on real PostgreSQL, including
 * genuinely concurrent transactions.
 */
export async function createTestDb(): Promise<Db> {
  const server = process.env.TEST_DATABASE_URL;
  if (!server) return create("memory:");
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const name = `shifthq_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new Pool({ connectionString: server, max: 1 });
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(server);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 20 });
  const db = drizzle(pool, { schema, casing: "snake_case" }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  Object.assign(db as object, { $pool: pool, $url: url.toString(), $name: name });
  return db;
}

/**
 * Tests: reconnect to the same test database as a restricted application role
 * (member of `shifthq_app`, mapped to one organization), so row-level security
 * applies to everything the code under test does. Real PostgreSQL only.
 */
export async function connectAsAppRole(ownerDb: Db, organizationId: string): Promise<Db> {
  const meta = ownerDb as unknown as { $url?: string; $name?: string; $pool?: { query: (q: string, p?: unknown[]) => Promise<unknown> } };
  if (!meta.$url || !meta.$pool) throw new Error("connectAsAppRole needs a TEST_DATABASE_URL database.");
  const role = `app_${meta.$name}`.slice(0, 63);
  await meta.$pool.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} login in role shifthq_app; end if; end $$`);
  await meta.$pool.query(`insert into app_tenant_roles (role_name, organization_id) values ($1, $2) on conflict (role_name) do update set organization_id = excluded.organization_id`, [role, organizationId]);
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const url = new URL(meta.$url);
  url.username = role;
  url.password = "";
  const pool = new Pool({ connectionString: url.toString(), max: 20 });
  return Object.assign(drizzle(pool, { schema, casing: "snake_case" }) as unknown as Db, { $pool: pool, $url: url.toString(), $name: meta.$name, $owner: ownerDb });
}

/** Tests: route getDb() to a specific instance. */
export function setDbForTests(db: Db) {
  g.__gshqDb = Promise.resolve(db);
}
