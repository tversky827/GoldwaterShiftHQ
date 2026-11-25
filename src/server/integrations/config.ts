/**
 * Integration configuration from environment variables. Credentials never
 * live in source code or the database in plain text.
 *
 * PAYCOR_MODE:  demo | sandbox | production    ("mock" is accepted as an alias for demo)
 * AOD_MODE:     demo | soap | file             ("mock" is accepted as an alias for demo)
 */
export type PaycorMode = "demo" | "sandbox" | "production";
export type AodMode = "demo" | "soap" | "file";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function mode<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = env(name);
  const v = raw === "mock" ? ("demo" as T) : (raw as T | undefined);
  if (!v) return fallback;
  if (allowed.includes(v)) return v;
  throw new Error(`${name} must be one of: ${allowed.join(", ")} (got "${raw}")`);
}

export function appBaseUrl(): string {
  return (env("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function getPaycorConfig() {
  const m = mode("PAYCOR_MODE", ["demo", "sandbox", "production"] as const, "demo");
  // Paycor documents apis.paycor.com; some Paycor material says sandbox uses
  // the same host and routes by subscription key, other material lists
  // apis-sandbox.paycor.com. Configurable until confirmed in the portal.
  const apiBaseUrl = (env("PAYCOR_API_BASE_URL") ?? "https://apis.paycor.com").replace(/\/+$/, "");
  return {
    mode: m,
    environment: m === "demo" ? ("mock" as const) : m,
    clientId: env("PAYCOR_CLIENT_ID"),
    clientSecret: env("PAYCOR_CLIENT_SECRET"),
    subscriptionKey: env("PAYCOR_SUBSCRIPTION_KEY"),
    appScope: env("PAYCOR_APP_SCOPE"),
    activationUrl: env("PAYCOR_ACTIVATION_URL"),
    apiBaseUrl,
    tokenUrl: env("PAYCOR_TOKEN_URL") ?? `${apiBaseUrl}/sts/v1/common/token`,
    redirectUri: `${appBaseUrl()}/api/integrations/paycor/callback`,
    /**
     * Minimum milliseconds between Paycor requests (client-side throttle).
     * 250 ms = 240 calls/minute, well under Paycor's documented 1,000/minute
     * shared across all of the app's Paycor API calls.
     */
    minRequestIntervalMs: Number(env("PAYCOR_MIN_REQUEST_INTERVAL_MS") ?? 250),
  };
}
export type PaycorConfig = ReturnType<typeof getPaycorConfig>;

export function getAodConfig() {
  const m = mode("AOD_MODE", ["demo", "soap", "file"] as const, "demo");
  return {
    mode: m,
    environment: m === "demo" ? ("mock" as const) : m === "file" ? ("file" as const) : env("AOD_ENVIRONMENT") === "production" ? ("production" as const) : ("test" as const),
    hostname: env("AOD_HOSTNAME")?.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
    port: Number(env("AOD_PORT") ?? 8192),
    accessAccount: env("AOD_ACCESS_ACCOUNT"),
    accessPassword: env("AOD_ACCESS_PASSWORD"),
    exportDir: env("AOD_EXPORT_DIR") ?? "./data/aod-exports",
  };
}
export type AodConfig = ReturnType<typeof getAodConfig>;

export function employeeMatchField(): "employeeNumber" | "badgeNumber" {
  return env("EMPLOYEE_MATCH_FIELD") === "badgeNumber" ? "badgeNumber" : "employeeNumber";
}

export function missingPaycorSettings(c = getPaycorConfig()): string[] {
  if (c.mode === "demo") return [];
  const missing: string[] = [];
  if (!c.clientId) missing.push("PAYCOR_CLIENT_ID");
  if (!c.clientSecret) missing.push("PAYCOR_CLIENT_SECRET");
  if (!c.subscriptionKey) missing.push("PAYCOR_SUBSCRIPTION_KEY");
  if (!c.appScope) missing.push("PAYCOR_APP_SCOPE");
  if (!c.activationUrl) missing.push("PAYCOR_ACTIVATION_URL");
  if (!env("APP_ENCRYPTION_KEY")) missing.push("APP_ENCRYPTION_KEY");
  return missing;
}

export function missingAodSettings(c = getAodConfig()): string[] {
  if (c.mode !== "soap") return [];
  const missing: string[] = [];
  if (!c.hostname) missing.push("AOD_HOSTNAME");
  if (!c.accessAccount) missing.push("AOD_ACCESS_ACCOUNT");
  if (!c.accessPassword) missing.push("AOD_ACCESS_PASSWORD");
  return missing;
}
