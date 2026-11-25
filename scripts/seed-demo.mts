/** Load the demonstration organization into the local (or DATABASE_URL) database. */
const { getDb } = await import("../src/db/index.ts");
const { seedDemo, DEMO_USERS, DEMO_PASSWORD_DEFAULT } = await import("../src/db/seed/demo.ts");
const db = await getDb();
const r = await seedDemo(db);
console.log(r.created ? "Demonstration data loaded." : "Demonstration data already present.");
console.log("\nDemo sign-ins (demonstration only):");
for (const u of DEMO_USERS) console.log(`  ${u.email.padEnd(28)} ${u.role}`);
console.log(`  password: ${process.env.DEMO_PASSWORD ? "(the DEMO_PASSWORD you set)" : DEMO_PASSWORD_DEFAULT}\n`);
process.exit(0);
