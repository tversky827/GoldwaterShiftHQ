/**
 * Paycor OAuth 2.0 (authorization code flow) in plain English:
 *  1. An admin clicks "Connect Paycor" and enters a legal entity ID.
 *  2. We send their browser to the Activation URL from Paycor AppCreator.
 *  3. They sign in to Paycor and approve the app for that legal entity.
 *  4. Paycor redirects back to our callback with a one-time code.
 *  5. The server exchanges the code (+ client secret) for an access token
 *     (~30 min) and a refresh token. Both are encrypted at rest.
 *
 * Paycor issues tokens PER LEGAL ENTITY; each has its own integration_connections row.
 * Every API call also sends the APIm subscription key header.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { getPaycorConfig, type PaycorConfig } from "../config";
import { decrypt, encrypt } from "../crypto";
import { explainHttpStatus, fetchWithRetry, IntegrationHttpError, redact } from "../http";

export const SUBSCRIPTION_KEY_HEADER = "Ocp-Apim-Subscription-Key";
const STATE_TTL_MS = 15 * 60 * 1000;

function hmacKey(): Buffer {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k) throw new Error("APP_ENCRYPTION_KEY is not set.");
  return crypto.createHash("sha256").update(`oauth-state:${k}`).digest();
}

/** State = signed {nonce, legalEntityId, userId, exp}. The nonce is also kept in an httpOnly cookie. */
export function signState(payload: { nonce: string; legalEntityId: string; userId: string; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", hmacKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string | null, nonceCookie: string | undefined): { legalEntityId: string; userId: string } | null {
  if (!state || !nonceCookie) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", hmacKey()).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p.nonce !== nonceCookie || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return { legalEntityId: String(p.legalEntityId), userId: String(p.userId) };
  } catch {
    return null;
  }
}

export function buildActivationUrl(legalEntityId: string, userId: string, c: PaycorConfig = getPaycorConfig()): { url: string; nonce: string } {
  if (!c.activationUrl) throw new Error("PAYCOR_ACTIVATION_URL is not set. Copy it from your app in Paycor AppCreator.");
  if (!c.clientId) throw new Error("PAYCOR_CLIENT_ID is not set.");
  if (!/^\d{1,12}$/.test(legalEntityId)) throw new Error("Enter the numeric Paycor legal entity ID.");
  const nonce = crypto.randomBytes(18).toString("base64url");
  const state = signState({ nonce, legalEntityId, userId, exp: Date.now() + STATE_TTL_MS });
  const url = new URL(c.activationUrl);
  const setIfMissing = (k: string, v: string) => {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  };
  setIfMissing("client_id", c.clientId);
  setIfMissing("response_type", "code");
  setIfMissing("redirect_uri", c.redirectUri);
  setIfMissing("scope", [c.appScope, "offline_access"].filter(Boolean).join(" "));
  url.searchParams.set("state", state);
  return { url: url.toString(), nonce };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(params: Record<string, string>, c: PaycorConfig): Promise<TokenResponse> {
  if (!c.subscriptionKey || !c.clientId || !c.clientSecret) throw new Error("Paycor client ID, client secret, and subscription key must all be set.");
  const res = await fetchWithRetry(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", [SUBSCRIPTION_KEY_HEADER]: c.subscriptionKey },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }),
  });
  if (!res.ok) throw new IntegrationHttpError(res.status, explainHttpStatus("Paycor", res.status), redact(await res.text().catch(() => "")));
  return (await res.json()) as TokenResponse;
}

function envOf(c: PaycorConfig): "sandbox" | "production" {
  return c.mode === "production" ? "production" : "sandbox";
}

async function saveTokens(db: Db, orgId: string, legalEntityId: string, t: TokenResponse, c: PaycorConfig, opts: { previousRefresh?: string; userId?: string } = {}) {
  const refresh = t.refresh_token ?? opts.previousRefresh;
  if (!refresh) throw new Error("Paycor did not return a refresh token. Check that the offline_access scope is allowed for the app.");
  const environment = envOf(c);
  const values = {
    accessTokenEnc: encrypt(t.access_token),
    refreshTokenEnc: encrypt(refresh),
    tokenExpiresAt: new Date(Date.now() + ((t.expires_in ?? 1800) - 120) * 1000),
    status: "connected" as const,
  };
  await db
    .insert(integrationConnections)
    .values({
      organizationId: orgId,
      provider: "paycor",
      environment,
      legalEntityId,
      displayName: `Paycor legal entity ${legalEntityId}`,
      ...values,
      authorizedBy: opts.userId ?? null,
      authorizedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [integrationConnections.organizationId, integrationConnections.provider, integrationConnections.environment, integrationConnections.legalEntityId],
      set: { ...values, ...(opts.userId ? { authorizedBy: opts.userId, authorizedAt: new Date() } : {}) },
    });
}

export async function exchangeCode(db: Db, orgId: string, legalEntityId: string, code: string, userId: string, c = getPaycorConfig()) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: c.redirectUri }, c);
  await saveTokens(db, orgId, legalEntityId, t, c, { userId });
}

/** Valid access token for one legal entity, refreshing when needed. */
export async function getAccessToken(db: Db, orgId: string, legalEntityId: string, c = getPaycorConfig()): Promise<string> {
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, orgId),
        eq(integrationConnections.provider, "paycor"),
        eq(integrationConnections.environment, envOf(c)),
        eq(integrationConnections.legalEntityId, legalEntityId),
      ),
    );
  if (!conn?.refreshTokenEnc) throw new Error(`Paycor is not connected for legal entity ${legalEntityId}. Click "Connect Paycor".`);
  if (conn.accessTokenEnc && conn.tokenExpiresAt && conn.tokenExpiresAt > new Date()) return decrypt(conn.accessTokenEnc);
  const previousRefresh = decrypt(conn.refreshTokenEnc);
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: previousRefresh }, c);
  await saveTokens(db, orgId, legalEntityId, t, c, { previousRefresh });
  return t.access_token;
}
