/**
 * Central configuration loader.
 *
 * All credentials come from environment variables - never from source code.
 * Each integration has a MODE so sandbox/test and production credentials can
 * never be mixed up silently: the mode is shown on the dashboard at all times.
 */

export type PaycorMode = "mock" | "sandbox" | "production";
export type AodMode = "mock" | "soap" | "file";
export type AodEnvironment = "test" | "production";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = env(name);
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`${name} must be one of: ${allowed.join(", ")} (got "${v}")`);
}

export interface PaycorConfig {
  mode: PaycorMode;
  clientId?: string;
  clientSecret?: string;
  subscriptionKey?: string;
  appScope?: string;
  activationUrl?: string;
  apiBaseUrl: string;
  tokenUrl: string;
  redirectUri: string;
  legalEntityIds: number[];
}

export interface AodConfig {
  mode: AodMode;
  environment: AodEnvironment;
  hostname?: string;
  port: number;
  accessAccount?: string;
  accessPassword?: string;
  exportDir: string;
}

export function appBaseUrl(): string {
  return (env("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function getPaycorConfig(): PaycorConfig {
  const mode = oneOf("PAYCOR_MODE", ["mock", "sandbox", "production"] as const, "mock");
  // Paycor documents apis.paycor.com for production. Some Paycor material
  // says sandbox uses the SAME host and routes by subscription key; other
  // material lists apis-sandbox.paycor.com. We default to the production host
  // and let PAYCOR_API_BASE_URL override it once confirmed in the portal.
  const apiBaseUrl = (env("PAYCOR_API_BASE_URL") ?? "https://apis.paycor.com").replace(/\/+$/, "");
  return {
    mode,
    clientId: env("PAYCOR_CLIENT_ID"),
    clientSecret: env("PAYCOR_CLIENT_SECRET"),
    subscriptionKey: env("PAYCOR_SUBSCRIPTION_KEY"),
    appScope: env("PAYCOR_APP_SCOPE"),
    activationUrl: env("PAYCOR_ACTIVATION_URL"),
    apiBaseUrl,
    tokenUrl: env("PAYCOR_TOKEN_URL") ?? `${apiBaseUrl}/sts/v1/common/token`,
    redirectUri: `${appBaseUrl()}/api/integrations/paycor/callback`,
    legalEntityIds: (env("PAYCOR_LEGAL_ENTITY_IDS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n)),
  };
}

export function getAodConfig(): AodConfig {
  return {
    mode: oneOf("AOD_MODE", ["mock", "soap", "file"] as const, "mock"),
    environment: oneOf("AOD_ENVIRONMENT", ["test", "production"] as const, "test"),
    hostname: env("AOD_HOSTNAME")?.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
    port: Number(env("AOD_PORT") ?? 8192),
    accessAccount: env("AOD_ACCESS_ACCOUNT"),
    accessPassword: env("AOD_ACCESS_PASSWORD"),
    exportDir: env("AOD_EXPORT_DIR") ?? "./data/aod-exports",
  };
}

export function employeeMatchField(): "employeeNumber" | "badgeNumber" {
  const v = env("EMPLOYEE_MATCH_FIELD") ?? "employeeNumber";
  return v === "badgeNumber" ? "badgeNumber" : "employeeNumber";
}

/** Which required settings are missing - shown in plain English on the dashboard. */
export function missingPaycorSettings(c = getPaycorConfig()): string[] {
  if (c.mode === "mock") return [];
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
  if (c.mode === "mock") return [];
  if (c.mode === "file") return [];
  const missing: string[] = [];
  if (!c.hostname) missing.push("AOD_HOSTNAME");
  if (!c.accessAccount) missing.push("AOD_ACCESS_ACCOUNT");
  if (!c.accessPassword) missing.push("AOD_ACCESS_PASSWORD");
  return missing;
}
