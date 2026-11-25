/**
 * Row-level security (drizzle/0008_row_level_security.sql).
 * Needs a real PostgreSQL server: TEST_DATABASE_URL=... npm run test:pg
 * (skipped on the embedded test database, which always runs as superuser).
 */
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { connectAsAppRole, createTestDb, type Db } from "@/db";
import { auditLogs, employees, facilities, organizations, shifts } from "@/db/schema";
import { seedDemo } from "@/db/seed/demo";

const real = !!process.env.TEST_DATABASE_URL;
const d = real ? describe : describe.skip;

let owner: Db;
let app: Db;
let orgA: string;
let orgB: string;
let facB: string;
let empB: string;

/** Drizzle wraps PostgreSQL errors; check the underlying database message. */
async function refused(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re);
    return;
  }
  throw new Error(`expected the database to refuse (${re})`);
}

async function rows<T = Record<string, unknown>>(db: Db, q: ReturnType<typeof sql>) {
  const r = (await db.execute(q)) as unknown as { rows: T[] };
  return r.rows;
}

d("row-level security", () => {
  beforeAll(async () => {
    owner = await createTestDb();
    orgA = (await seedDemo(owner, { password: "Test-Password-123", schedules: false })).organizationId;
    // A second, unrelated organization with one facility and one employee.
    const [b] = await owner.insert(organizations).values({ name: "Other Org", defaultTimezone: "America/Chicago" }).returning();
    orgB = b.id;
    const [f] = await owner.insert(facilities).values({ organizationId: orgB, name: "Other Facility", code: "OTH", timezone: "America/Chicago" }).returning();
    facB = f.id;
    const [e] = await owner.insert(employees).values({ organizationId: orgB, firstName: "Olive", lastName: "Other", homeFacilityId: facB }).returning();
    empB = e.id;
    app = await connectAsAppRole(owner, orgA);
  });

  it("the application really is the restricted role", async () => {
    const [r] = await rows<{ u: string; org: string }>(app, sql`select current_user as u, app_org_id()::text as org`);
    expect(r.u).toMatch(/^app_/);
    expect(r.org).toBe(orgA);
  });

  it("sees only its own organization's rows, including through child tables", async () => {
    const facs = await app.select().from(facilities);
    expect(facs.length).toBe(11);
    expect(facs.every((f) => f.organizationId === orgA)).toBe(true);
    expect((await app.select().from(organizations)).map((o) => o.id)).toEqual([orgA]);
    expect((await rows(app, sql`select id from employees where id = ${empB}`)).length).toBe(0);
    // The owner still sees both organizations.
    expect((await owner.select().from(organizations)).length).toBe(2);
  });

  it("cannot write rows for another organization, or move rows into one", async () => {
    await refused(app.insert(facilities).values({ organizationId: orgB, name: "Sneaky", code: "SNK", timezone: "UTC" }), /row-level security/);
    const [cna] = await rows<{ id: string }>(owner, sql`select id from positions where organization_id = ${orgA} limit 1`);
    const start = new Date(Date.now() + 86_400_000);
    await refused(app.insert(shifts).values({ facilityId: facB, positionId: cna.id, workDate: "2030-01-01", startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), paidHours: "1", requiredCount: 1 }), /row-level security/);
    const updated = await rows(app, sql`update employees set first_name = 'Hacked' where id = ${empB} returning id`);
    expect(updated.length).toBe(0);
    const [mine] = await app.select().from(facilities).limit(1);
    await refused(app.execute(sql`update facilities set organization_id = ${orgB} where id = ${mine.id}`), /row-level security/);
  });

  it("can't change its own tenant mapping, the audit log, or hard-delete history", async () => {
    await refused(app.execute(sql`update app_tenant_roles set organization_id = ${orgB}`), /permission denied/);
    await refused(app.execute(sql`insert into app_tenant_roles (role_name, organization_id) values ('x', ${orgB})`), /permission denied/);
    await refused(app.execute(sql`update audit_logs set action = 'x'`), /permission denied/);
    await refused(app.execute(sql`delete from audit_logs`), /permission denied/);
    await refused(app.execute(sql`delete from employees`), /permission denied/);
    expect((await app.select().from(auditLogs)).every((a) => a.organizationId === orgA)).toBe(true);
  });

  it("a restricted role with no tenant mapping sees nothing (fails closed)", async () => {
    const meta = owner as unknown as { $pool: { query: (q: string) => Promise<unknown> }; $url: string };
    await meta.$pool.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'app_unmapped_probe') then create role app_unmapped_probe login in role shifthq_app; end if; end $$`);
    const { Pool } = await import("pg");
    const url = new URL(meta.$url);
    url.username = "app_unmapped_probe";
    const p = new Pool({ connectionString: url.toString(), max: 1 });
    const r = await p.query("select count(*)::int as n from facilities");
    expect(r.rows[0].n).toBe(0);
    await p.end();
  });

  it("every table with tenant data has row-level security enabled", async () => {
    const r = await rows<{ t: string }>(owner, sql`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname not in ('permissions', 'rate_limits', 'app_tenant_roles')`);
    expect(r.map((x) => x.t)).toEqual([]);
  });
});
