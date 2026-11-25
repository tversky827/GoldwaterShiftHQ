/**
 * Paycor OAuth 2.0 ("authorization code" flow) - plain-English summary:
 *
 * 1. An admin clicks "Connect Paycor" in our dashboard.
 * 2. We send their browser to Paycor's activation page (the Activation URL
 *    from AppCreator). They log in to Paycor and approve our app for a
 *    legal entity (a company/EIN in Paycor).
 * 3. Paycor sends the browser back to our "redirect URL" with a one-time code.
 * 4. Our server trades that code (plus our client secret) for:
 *      - an access token (works ~30 minutes), and
 *      - a refresh token (used to get new access tokens without re-approval).
 * 5. Tokens are encrypted and stored server-side. They are never shown.
 *
 * Paycor issues tokens PER LEGAL ENTITY, so step 2 is repeated per entity.
 * Every API call also needs the APIm subscription key header.
 */
import crypto from "node:crypto";
import { getPaycorConfig, type PaycorConfig } from "../../config";
import { decrypt, encrypt } from "../../store/crypto";
import { readDb, writeDb } from "../../store/db";
import { explainHttpStatus, IntegrationHttpError, redact } from "../http";

export const SUBSCRIPTION_KEY_HEADER = "Ocp-Apim-Subscription-Key";
const STATE_TTL_MS = 15 * 60 * 1000;

export function buildActivationUrl(legalEntityHint: number | null, c: PaycorConfig = getPaycorConfig()): string {
  if (!c.activationUrl) throw new Error("PAYCOR_ACTIVATION_URL is not set. Copy it from your app in Paycor AppCreator.");
  if (!c.clientId) throw new Error("PAYCOR_CLIENT_ID is not set.");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const state = legalEntityHint ? `${nonce}.${legalEntityHint}` : nonce;
  writeDb((db) => {
    const cutoff = Date.now() - STATE_TTL_MS;
    db.oauthStates = db.oauthStates.filter((s) => Date.parse(s.createdAt) > cutoff);
    db.oauthStates.push({ state, createdAt: new Date().toISOString() });
  });

  const url = new URL(c.activationUrl);
  const setIfMissing = (k: string, v: string) => {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  };
  setIfMissing("client_id", c.clientId);
  setIfMissing("response_type", "code");
  setIfMissing("redirect_uri", c.redirectUri);
  // offline_access is what lets Paycor give us a refresh token.
  setIfMissing("scope", [c.appScope, "offline_access"].filter(Boolean).join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

/** Validates and consumes a state value (protects against forged callbacks). */
export function consumeState(state: string | null): { ok: boolean; legalEntityHint: number | null } {
  if (!state) return { ok: false, legalEntityHint: null };
  let found = false;
  writeDb((db) => {
    const cutoff = Date.now() - STATE_TTL_MS;
    const idx = db.oauthStates.findIndex((s) => s.state === state && Date.parse(s.createdAt) > cutoff);
    if (idx >= 0) {
      found = true;
      db.oauthStates.splice(idx, 1);
    }
  });
  const hint = state.includes(".") ? Number(state.split(".")[1]) : NaN;
  return { ok: found, legalEntityHint: Number.isFinite(hint) ? hint : null };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(params: Record<string, string>, c: PaycorConfig): Promise<TokenResponse> {
  if (!c.subscriptionKey || !c.clientId || !c.clientSecret) {
    throw new Error("Paycor client ID, client secret, and subscription key must all be set.");
  }
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params });
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      [SUBSCRIPTION_KEY_HEADER]: c.subscriptionKey,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new IntegrationHttpError(res.status, explainHttpStatus("Paycor", res.status), redact(text));
  }
  return (await res.json()) as TokenResponse;
}

function saveTokens(t: TokenResponse, legalEntityId: number | null, c: PaycorConfig, previousRefresh?: string) {
  const refresh = t.refresh_token ?? previousRefresh;
  if (!refresh) throw new Error("Paycor did not return a refresh token. Check that the offline_access scope is requested.");
  const mode = c.mode === "production" ? "production" : "sandbox";
  writeDb((db) => {
    db.paycorTokens = db.paycorTokens.filter((r) => !(r.mode === mode && r.legalEntityId === legalEntityId));
    db.paycorTokens.push({
      legalEntityId,
      mode,
      accessTokenEnc: encrypt(t.access_token),
      refreshTokenEnc: encrypt(refresh),
      // Refresh 2 minutes early to be safe. Paycor documents ~30 minute tokens.
      expiresAt: new Date(Date.now() + ((t.expires_in ?? 1800) - 120) * 1000).toISOString(),
    });
  });
}

export async function exchangeCode(code: string, legalEntityId: number | null, c = getPaycorConfig()) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: c.redirectUri }, c);
  saveTokens(t, legalEntityId, c);
}

/** Returns a valid access token for a legal entity, refreshing if needed. */
export async function getAccessToken(legalEntityId: number | null, c = getPaycorConfig()): Promise<string> {
  const mode = c.mode === "production" ? "production" : "sandbox";
  const tokens = readDb().paycorTokens.filter((r) => r.mode === mode);
  const rec =
    tokens.find((r) => r.legalEntityId === legalEntityId) ??
    (tokens.length === 1 ? tokens[0] : undefined);
  if (!rec) {
    throw new Error(
      `Paycor is not connected${legalEntityId ? ` for legal entity ${legalEntityId}` : ""}. Click "Connect Paycor" on the integration dashboard.`,
    );
  }
  if (Date.parse(rec.expiresAt) > Date.now()) return decrypt(rec.accessTokenEnc);
  const previousRefresh = decrypt(rec.refreshTokenEnc);
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: previousRefresh }, c);
  saveTokens(t, rec.legalEntityId, c, previousRefresh);
  return t.access_token;
}

export function connectedLegalEntities(c = getPaycorConfig()): (number | null)[] {
  const mode = c.mode === "production" ? "production" : "sandbox";
  return readDb().paycorTokens.filter((r) => r.mode === mode).map((r) => r.legalEntityId);
}
