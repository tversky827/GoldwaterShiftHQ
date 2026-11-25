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
const { getPaycorConfig, getAodConfig, missingPaycorSettings, missingAodSettings } = await import("../src/server/integrations/config.ts");
const show = (name: string) => (process.env[name] ? "set" : "EMPTY");
const p = getPaycorConfig();
const a = getAodConfig();
console.log(`\nPaycor mode: ${p.mode}`);
for (const k of ["PAYCOR_CLIENT_ID", "PAYCOR_CLIENT_SECRET", "PAYCOR_SUBSCRIPTION_KEY", "PAYCOR_APP_SCOPE", "PAYCOR_ACTIVATION_URL"]) console.log(`  ${k.padEnd(28)} ${show(k)}`);
console.log(`  Redirect URL to register:   ${p.redirectUri}`);
console.log(`  Missing for this mode:      ${missingPaycorSettings(p).join(", ") || "nothing"}`);
console.log(`\nAttendance on Demand mode: ${a.mode} (${a.environment})`);
for (const k of ["AOD_HOSTNAME", "AOD_ACCESS_ACCOUNT", "AOD_ACCESS_PASSWORD"]) console.log(`  ${k.padEnd(28)} ${show(k)}`);
console.log(`  Missing for this mode:      ${missingAodSettings(a).join(", ") || "nothing"}`);
console.log(`\nNotifications: in-app always on`);
console.log(`  Email:  ${process.env.NOTIFY_EMAIL_PROVIDER || "off"}${process.env.NOTIFY_EMAIL_PROVIDER === "smtp" ? `  (SMTP_HOST ${show("SMTP_HOST")}, SMTP_USER ${show("SMTP_USER")}, SMTP_PASSWORD ${show("SMTP_PASSWORD")})` : process.env.NOTIFY_EMAIL_PROVIDER === "sendgrid" ? `  (SENDGRID_API_KEY ${show("SENDGRID_API_KEY")})` : ""}${process.env.NOTIFY_EMAIL_PROVIDER ? `  NOTIFY_EMAIL_FROM ${show("NOTIFY_EMAIL_FROM")}` : ""}`);
console.log(`  Texts:  ${process.env.NOTIFY_SMS_PROVIDER || "off"}${process.env.NOTIFY_SMS_PROVIDER === "twilio" ? `  (TWILIO_ACCOUNT_SID ${show("TWILIO_ACCOUNT_SID")}, TWILIO_AUTH_TOKEN ${show("TWILIO_AUTH_TOKEN")}, sender ${process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID ? "set" : "EMPTY"})` : ""}`);
console.log(`\nDatabase: ${process.env.DATABASE_URL ? "DATABASE_URL set" : "embedded (local ./data/pglite)"}   Encryption key: ${show("APP_ENCRYPTION_KEY")}\n`);
