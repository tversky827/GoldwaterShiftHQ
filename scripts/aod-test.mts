/**
 * READ-ONLY live check of the Attendance on Demand connection.
 *   npm run aod:test
 * Uses AOD_HOSTNAME, AOD_ACCESS_ACCOUNT, AOD_ACCESS_PASSWORD (from the
 * environment or .env.local). Prints only counts and setting names: no
 * employee names, punches or passwords. Writes nothing anywhere.
 */
import fs from "node:fs";
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.AOD_MODE = "soap";
const { AodSoapClient } = await import("../src/server/integrations/aod/soap.ts");
const { getAodConfig } = await import("../src/server/integrations/config.ts");
const c = getAodConfig();
const show = (k: string) => (process.env[k] ? "set" : "EMPTY");
console.log(`\nAOD address: ${c.hostname ?? "EMPTY"}:${c.port}   account: ${show("AOD_ACCESS_ACCOUNT")}   password: ${show("AOD_ACCESS_PASSWORD")}   time zone: ${c.timeZone}`);
const client = new AodSoapClient(c);
const t = await client.testConnection();
console.log(`\n1) Connection: ${t.ok ? "OK" : "PROBLEM"} - ${t.message}`);
if (t.details?.hyperQueries) console.log(`   Saved employee lists in AOD: ${(t.details.hyperQueries as string[]).length}`);
if (!t.ok) process.exit(1);
const emps = await client.fetchEmployees();
const active = emps.filter((e) => e.active);
console.log(`\n2) Employees: ${emps.length} in AOD (${active.length} active). With an employee ID: ${emps.filter((e) => e.employeeNumber).length}. With a badge: ${emps.filter((e) => e.badgeNumber).length}.`);
const groups = new Map<string, number>();
for (const e of active) groups.set(e.homeFacility ?? "(none)", (groups.get(e.homeFacility ?? "(none)") ?? 0) + 1);
console.log(`   Distinct work groups among active employees: ${groups.size}`);
const to = new Date();
const from = new Date(to.getTime() - 7 * 86_400_000);
const segs = await client.fetchAttendance(from, to);
const open = segs.filter((s) => !s.punchOut).length;
const hours = segs.reduce((s, x) => s + (x.hours ?? 0), 0);
console.log(`\n3) Punches, last 7 days: ${segs.length} worked shifts, ${Math.round(hours)} hours in total, ${open} without a clock-out yet.`);
console.log("\nRead-only check finished. Nothing was changed in Attendance on Demand or in ShiftHQ.\n");
