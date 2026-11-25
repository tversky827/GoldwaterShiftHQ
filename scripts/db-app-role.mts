/**
 * Creates (or updates) the restricted database login the application uses in
 * production, and ties it to one organization so row-level security applies.
 * Run ONCE, as the database owner, after `npm run db:migrate` and `npm run bootstrap`:
 *
 *   DATABASE_URL=<owner connection> APP_DB_PASSWORD=<new strong password> \
 *     npm run db:app-role -- --org "Goldwater Care" [--role shifthq_app_goldwater]
 *
 * Then point the running app's DATABASE_URL at this new login (same host and
 * database, username = the role name, password = APP_DB_PASSWORD). Keep the
 * owner login for migrations and backups only. The password is never printed.
 */
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((a) => { const [k, ...v] = a.trim().split(" "); return [k, v.join(" ").replace(/^"|"$/g, "")]; }));
const url = process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;
const role = (args.role || "shifthq_app_main").toLowerCase();
if (!url || url.startsWith("pglite:") || url.startsWith("memory:")) {
  console.error("Set DATABASE_URL to the production database (owner login). The embedded development database doesn't use separate logins.");
  process.exit(1);
}
if (!args.org) {
  console.error('Usage: npm run db:app-role -- --org "Organization name" [--role shifthq_app_name]');
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]{2,62}$/.test(role)) {
  console.error("The role name may contain lowercase letters, digits and underscores only.");
  process.exit(1);
}
if (!password || password.length < 20) {
  console.error("Set APP_DB_PASSWORD to a new random password of at least 20 characters (it is never printed).");
  process.exit(1);
}
const { Pool } = await import("pg");
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const org = await pool.query("select id, name from organizations where name = $1", [args.org]);
  if (!org.rowCount) throw new Error(`No organization named "${args.org}". Run npm run bootstrap first.`);
  const exists = await pool.query("select 1 from pg_roles where rolname = $1", [role]);
  // Identifiers can't be parameters; the role name is validated above. The password is sent as a literal via format().
  const ddl = await pool.query(exists.rowCount ? "select format('alter role %I with login password %L', $1::text, $2::text) as q" : "select format('create role %I with login password %L in role shifthq_app', $1::text, $2::text) as q", [role, password]);
  await pool.query(ddl.rows[0].q);
  if (exists.rowCount) await pool.query((await pool.query("select format('grant shifthq_app to %I', $1::text) as q", [role])).rows[0].q);
  await pool.query("insert into app_tenant_roles (role_name, organization_id) values ($1, $2) on conflict (role_name) do update set organization_id = excluded.organization_id", [role, org.rows[0].id]);
  console.log(`\nDatabase login "${role}" is ready for "${org.rows[0].name}".`);
  console.log("Next: set the app's DATABASE_URL to use this login (username = the role name above, password = the one you chose).");
  console.log("Keep the owner login for migrations (npm run db:migrate) and backups only.\n");
} finally {
  await pool.end();
}
