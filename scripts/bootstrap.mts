/**
 * Production bootstrap: creates the organization, default roles and the first
 * Corporate Admin, and prints a one-time invitation link. No demo data.
 *
 *   npm run bootstrap -- --org "Goldwater Care" --email you@company.com --name "Your Name"
 */
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((a) => { const [k, ...v] = a.trim().split(" "); return [k, v.join(" ").replace(/^"|"$/g, "")]; }));
if (!args.org || !args.email || !args.name) {
  console.error('Usage: npm run bootstrap -- --org "Organization name" --email admin@company.com --name "Full Name"');
  process.exit(1);
}
const { getDb } = await import("../src/db/index.ts");
const { organizations, users, userRoles } = await import("../src/db/schema.ts");
const { seedDefaultRoles } = await import("../src/db/seed/base.ts");
const { createInvitation } = await import("../src/server/auth/service.ts");
const { appBaseUrl } = await import("../src/server/integrations/config.ts");
const { eq, sql } = await import("drizzle-orm");
const db = await getDb();
let [org] = await db.select().from(organizations).where(eq(organizations.name, args.org));
if (!org) [org] = await db.insert(organizations).values({ name: args.org }).returning();
const roleIds = await seedDefaultRoles(db, org.id);
const { seedDefaultRules } = await import("../src/db/seed/rules.ts");
await seedDefaultRules(db, org.id);
let [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${args.email.toLowerCase()}`);
if (!u) {
  [u] = await db.insert(users).values({ organizationId: org.id, email: args.email.toLowerCase(), displayName: args.name, status: "invited" }).returning();
  await db.insert(userRoles).values({ userId: u.id, roleId: roleIds.corporate_admin, scopeType: "organization" });
}
const token = await createInvitation(db, u.id, null);
console.log(`\nOrganization: ${org.name}\nInvitation link for ${u.email} (valid 7 days, single use):\n\n  ${appBaseUrl()}/invite/${token}\n`);
process.exit(0);
