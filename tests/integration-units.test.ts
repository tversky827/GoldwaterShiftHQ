import { describe, expect, it } from "vitest";
import { parseCsv } from "@/server/integrations/aod/csv";
import { parseAodExport } from "@/server/integrations/aod/file";
import { buildSoapEnvelope, parseWsdlOperations } from "@/server/integrations/aod/soap";
import { fetchWithRetry, redact } from "@/server/integrations/http";
import { assertCanWrite, OwnershipViolation } from "@/server/integrations/ownership";
import { mapPaycorEmployee, normalizeStatus } from "@/server/integrations/paycor/client";
import { buildActivationUrl, verifyState } from "@/server/integrations/paycor/oauth";
import { decrypt, encrypt } from "@/server/integrations/crypto";
import type { PaycorConfig } from "@/server/integrations/config";

process.env.APP_ENCRYPTION_KEY ??= "test-encryption-key";

const cfg = {
  mode: "sandbox", environment: "sandbox", clientId: "cid", clientSecret: "s", subscriptionKey: "k", appScope: "myscope",
  activationUrl: "https://example.test/activate", apiBaseUrl: "https://apis.paycor.com", tokenUrl: "https://apis.paycor.com/sts/v1/common/token",
  redirectUri: "http://localhost:3000/api/integrations/paycor/callback", minRequestIntervalMs: 0,
} as PaycorConfig;

describe("Paycor OAuth", () => {
  it("builds the activation URL with offline_access and a signed, cookie-bound state", () => {
    const { url, nonce } = buildActivationUrl("12345", "user-1", cfg);
    const u = new URL(url);
    expect(u.searchParams.get("scope")).toBe("myscope offline_access");
    expect(u.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    const state = u.searchParams.get("state")!;
    expect(verifyState(state, nonce)).toEqual({ legalEntityId: "12345", userId: "user-1" });
    expect(verifyState(state, "other-nonce")).toBeNull();
    expect(verifyState(state.slice(0, -2) + "xx", nonce)).toBeNull();
  });
  it("rejects non-numeric legal entity IDs", () => {
    expect(() => buildActivationUrl("abc", "u", cfg)).toThrow(/numeric/);
  });
  it("encrypts tokens at rest", () => {
    const e = encrypt("secret-token");
    expect(e).not.toContain("secret-token");
    expect(decrypt(e)).toBe("secret-token");
  });
});

describe("Paycor mapping", () => {
  it("maps nested fields defensively", () => {
    const e = mapPaycorEmployee({ id: "abc", employeeNumber: 42, firstName: "A", lastName: "B", employmentDateData: { hireDate: "2020-01-01T00:00:00" }, status: "Active" }, "7");
    expect(e).toMatchObject({ paycorEmployeeId: "abc", employeeNumber: "42", status: "active", hireDate: "2020-01-01", legalEntityId: "7" });
  });
  it("normalizes status", () => {
    expect(normalizeStatus("Terminated")).toBe("terminated");
    expect(normalizeStatus("Leave of Absence")).toBe("leave");
    expect(normalizeStatus(undefined)).toBe("unknown");
  });
});

describe("HTTP resilience", () => {
  const noSleep = async () => {};
  it("retries 429/5xx with backoff, honoring Retry-After", async () => {
    const waits: number[] = [];
    let calls = 0;
    const res = await fetchWithRetry("https://x.test", {}, {
      fetchImpl: (async () => (++calls < 3 ? new Response("", { status: calls === 1 ? 429 : 503, headers: { "retry-after": "2" } }) : new Response("ok"))) as typeof fetch,
      sleepImpl: async (ms) => void waits.push(ms),
    });
    expect(await res.text()).toBe("ok");
    expect(calls).toBe(3);
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
  });
  it("does not retry other 4xx", async () => {
    let calls = 0;
    const res = await fetchWithRetry("https://x.test", {}, { fetchImpl: (async () => (calls++, new Response("", { status: 403 }))) as typeof fetch, sleepImpl: noSleep });
    expect(res.status).toBe(403);
    expect(calls).toBe(1);
  });
  it("redacts secrets from error bodies", () => {
    expect(redact('{"access_token":"abc","x":1} Bearer abc.def')).not.toMatch(/abc/);
  });
});

describe("ownership guard", () => {
  it("blocks writes to fields owned by another system", () => {
    expect(() => assertCanWrite("paycor", ["employmentStatus", "homeFacilityId"])).not.toThrow();
    expect(() => assertCanWrite("paycor", ["isRegionalPool"])).toThrow(OwnershipViolation);
    expect(() => assertCanWrite("aod", ["employmentStatus"])).toThrow(OwnershipViolation);
  });
});

describe("Attendance on Demand parsing", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  });
  it("maps common headers and handles overnight shifts", () => {
    const p = parseAodExport("Employee Number,First Name,Last Name,Facility,Date,In,Out,Hours\n1001,Avery,Sample,Maple Grove,2026-11-23,19:00,07:00,12\n");
    const r = p.attendance[0];
    expect(Date.parse(r.punchOut!) - Date.parse(r.punchIn!)).toBe(12 * 3600_000);
  });
  it("reports files without an employee column instead of guessing", () => {
    expect(parseAodExport("Name,Date\nX,2026-11-23\n").problems[0]).toMatch(/no employee number/);
  });
  it("lists WSDL operations and escapes SOAP values", () => {
    expect(parseWsdlOperations('<operation name="getEmployee"/><wsdl:operation name="punchEmployeeNowByIDNum">')).toEqual(["getEmployee", "punchEmployeeNowByIDNum"]);
    expect(buildSoapEnvelope("m", { a: "<x&>" })).toContain("<a>&lt;x&amp;&gt;</a>");
  });
});
