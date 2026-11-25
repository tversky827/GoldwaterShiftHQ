/**
 * Runs the whole test suite against a REAL PostgreSQL server.
 *   TEST_DATABASE_URL=postgres://user@host:5432/postgres npm run test:pg
 * The user must be allowed to CREATE DATABASE (each test file gets its own).
 */
import { spawnSync } from "node:child_process";
if (!process.env.TEST_DATABASE_URL) {
  console.error("Set TEST_DATABASE_URL to a PostgreSQL server (user with CREATE DATABASE).");
  process.exit(2);
}
const r = spawnSync("npx", ["vitest", "run", ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
