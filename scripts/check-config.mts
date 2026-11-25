/**
 * Run with:  npm run check-config
 * Reports which settings are filled in WITHOUT printing any secret values.
 */
import fs from "node:fs";
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const { getPaycorConfig, getAodConfig, missingPaycorSettings, missingAodSettings } = await import("../src/lib/config.ts");
const show = (name: string) => (process.env[name] ? "set" : "EMPTY");
const p = getPaycorConfig();
const a = getAodConfig();
console.log(`\nPaycor mode: ${p.mode}`);
for (const k of ["PAYCOR_CLIENT_ID", "PAYCOR_CLIENT_SECRET", "PAYCOR_SUBSCRIPTION_KEY", "PAYCOR_APP_SCOPE", "PAYCOR_ACTIVATION_URL", "PAYCOR_LEGAL_ENTITY_IDS"]) console.log(`  ${k.padEnd(28)} ${show(k)}`);
console.log(`  Redirect URL to register:   ${p.redirectUri}`);
console.log(`  Missing for this mode:      ${missingPaycorSettings(p).join(", ") || "nothing"}`);
console.log(`\nAttendance on Demand mode: ${a.mode} (${a.environment})`);
for (const k of ["AOD_HOSTNAME", "AOD_ACCESS_ACCOUNT", "AOD_ACCESS_PASSWORD"]) console.log(`  ${k.padEnd(28)} ${show(k)}`);
console.log(`  Missing for this mode:      ${missingAodSettings(a).join(", ") || "nothing"}`);
console.log(`\nAdmin password: ${show("ADMIN_PASSWORD")}   Encryption key: ${show("APP_ENCRYPTION_KEY")}\n`);
