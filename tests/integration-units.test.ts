import { describe, expect, it } from "vitest";
import { parseCsv } from "@/server/integrations/aod/csv";
import { parseAodExport } from "@/server/integrations/aod/file";
import { buildSoapEnvelope, parseWsdlOperations } from "@/server/integrations/aod/soap";
import { fetchWithRetry, redact } from "@/server/integrations/http";
import { assertCanWrite, OwnershipViolation } from "@/server/integrations/ownership";
import { departmentNames, employmentClassOf, mapPaycorEmployee, mapPayRate, normalizeStatus } from "@/server/integrations/paycor/client";
import { normalizeEmploymentType } from "@/server/integrations/paycor/sync";
import { buildActivationUrl, pkceChallenge, pkceVerifier, verifyState } from "@/server/integrations/paycor/oauth";
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
    expect(verifyState(state, nonce)).toEqual({ legalEntityId: "12345", userId: "user-1", nonce });
    expect(verifyState(state, "other-nonce")).toBeNull();
    expect(verifyState(state.slice(0, -2) + "xx", nonce)).toBeNull();
  });
  it("adds a PKCE S256 challenge whose verifier only the server can compute", () => {
    const { url, nonce } = buildActivationUrl("12345", "user-1", cfg);
    const u = new URL(url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const verifier = pkceVerifier(nonce);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier));
    expect(u.searchParams.get("code_challenge")).not.toBe(verifier);
    expect(url).not.toContain(verifier);
    // Paycor requires "+" between scope names, never %2B.
    expect(url).toContain("scope=myscope+offline_access");
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
  it("maps an employee shaped exactly like Paycor's API specification", () => {
    const depts = departmentNames([{ id: "d-1", code: "200", description: "Nursing" }]);
    const e = mapPaycorEmployee(
      {
        id: "e-1", firstName: "Ana", lastName: "Diaz", employeeNumber: "1042", badgeNumber: "77",
        email: { type: "Work", emailAddress: "ana@example.test" },
        employmentDateData: { hireDate: "2019-04-01T00:00:00Z", terminationDate: null },
        statusData: { isFullTime: false, status: "LeaveWithoutPay", type: "Regular" },
        positionData: { jobTitle: "Certified Nursing Assistant", jobCode: "CNA" },
        workLocation: { id: "w-1", name: "Maple Grove" },
        department: { id: "d-1", url: "v1/departments/d-1" },
      },
      "501123",
      depts,
    );
    expect(e).toMatchObject({ paycorEmployeeId: "e-1", email: "ana@example.test", status: "leave", hireDate: "2019-04-01", position: "Certified Nursing Assistant", department: "Nursing", location: "Maple Grove", employmentClass: "Part Time (Regular)" });
    expect(normalizeEmploymentType(e.employmentClass)).toBe("part_time");
    expect(normalizeEmploymentType(employmentClassOf({ statusData: { isFullTime: true, type: "Regular" } }))).toBe("full_time");
    expect(normalizeEmploymentType(employmentClassOf({ statusData: { isFullTime: false, type: "Casual" } }))).toBe("prn");
    expect(normalizeEmploymentType(employmentClassOf({ statusData: { type: "Seasonal" } }))).toBe("temporary");
  });
  it("treats every Paycor separation status as terminated, and leaves as leave", () => {
    for (const s of ["Terminated", "Resigned", "Retired", "Deceased"]) expect(normalizeStatus(s)).toBe("terminated");
    for (const s of ["Fmla", "LeaveWithPay", "LeaveWithoutPay", "ShortTermDisability", "LongTermDisability", "WorkersCompensation", "ThirdPartyPayable"]) expect(normalizeStatus(s)).toBe("leave");
    expect(normalizeStatus("LaidOff")).toBe("inactive");
    expect(normalizeStatus("Active")).toBe("active");
  });
  it("maps pay rates: hourly as-is, salary at 2,080 hours, unpaid and ended rates skipped", () => {
    expect(mapPayRate({ type: "Hourly", payRate: 21.5, effectiveStartDate: "2026-01-04T00:00:00Z" }, "e")).toMatchObject({ payType: "hourly", hourlyRate: 21.5, effectiveFrom: "2026-01-04" });
    expect(mapPayRate({ type: "Salary", payRate: 3000, annualPayRate: 78000 }, "e")).toMatchObject({ payType: "salary", hourlyRate: 37.5 });
    expect(mapPayRate({ type: "Unpaid", payRate: 0 }, "e")).toBeNull();
    expect(mapPayRate({ type: "Hourly", payRate: 20, effectiveEndDate: "2020-01-01" }, "e")).toBeNull();
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
  it("does not retry 5xx or network errors when told not to (single-use POSTs)", async () => {
    let calls = 0;
    const res = await fetchWithRetry("https://x.test", { method: "POST" }, { retryServerErrors: false, fetchImpl: (async () => (calls++, new Response("", { status: 500 }))) as typeof fetch, sleepImpl: noSleep });
    expect(res.status).toBe(500);
    expect(calls).toBe(1);
    calls = 0;
    await expect(fetchWithRetry("https://x.test", {}, { retryNetworkErrors: false, fetchImpl: (async () => { calls++; throw new Error("reset"); }) as typeof fetch, sleepImpl: noSleep })).rejects.toThrow("reset");
    expect(calls).toBe(1);
    // 429 is still retried: Paycor processed nothing.
    calls = 0;
    const r2 = await fetchWithRetry("https://x.test", {}, { retryServerErrors: false, fetchImpl: (async () => (++calls < 2 ? new Response("", { status: 429 }) : new Response("ok"))) as typeof fetch, sleepImpl: noSleep });
    expect(r2.status).toBe(200);
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
    expect(buildSoapEnvelope("m", { a: "<x&>" })).toContain('<a xsi:type="xsd:string">&lt;x&amp;&gt;</a>');
  });
});
