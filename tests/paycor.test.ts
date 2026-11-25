import { beforeEach, describe, expect, it } from "vitest";
import { mapPaycorEmployee, normalizeStatus } from "@/lib/integrations/paycor/client";
import { buildActivationUrl, consumeState } from "@/lib/integrations/paycor/oauth";
import { decrypt, encrypt } from "@/lib/store/crypto";
import { resetDbForTests } from "@/lib/store/db";
import type { PaycorConfig } from "@/lib/config";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = path.join(os.tmpdir(), `gshq-test-${process.pid}`);
process.env.APP_ENCRYPTION_KEY = "test-key";

const cfg: PaycorConfig = {
  mode: "sandbox", clientId: "cid", clientSecret: "s", subscriptionKey: "k", appScope: "myscope",
  activationUrl: "https://example.test/activate", apiBaseUrl: "https://apis.paycor.com",
  tokenUrl: "https://apis.paycor.com/sts/v1/common/token", redirectUri: "http://localhost:3000/api/integrations/paycor/callback", legalEntityIds: [],
};

describe("Paycor OAuth", () => {
  beforeEach(() => resetDbForTests());
  it("builds activation URL with offline_access, redirect and a one-time state", () => {
    const u = new URL(buildActivationUrl(123, cfg));
    expect(u.searchParams.get("scope")).toBe("myscope offline_access");
    expect(u.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    const state = u.searchParams.get("state")!;
    expect(consumeState(state)).toEqual({ ok: true, legalEntityHint: 123 });
    expect(consumeState(state).ok).toBe(false); // single use
  });
  it("rejects forged state", () => {
    expect(consumeState("forged").ok).toBe(false);
  });
  it("keeps parameters already present in the portal's activation URL", () => {
    const u = new URL(buildActivationUrl(null, { ...cfg, activationUrl: "https://example.test/a?client_id=fromportal&scope=abc" }));
    expect(u.searchParams.get("client_id")).toBe("fromportal");
    expect(u.searchParams.get("scope")).toBe("abc");
  });
  it("encrypts tokens at rest", () => {
    const e = encrypt("secret-token");
    expect(e).not.toContain("secret-token");
    expect(decrypt(e)).toBe("secret-token");
  });
});

describe("Paycor employee mapping", () => {
  it("maps nested fields defensively", () => {
    const e = mapPaycorEmployee({ id: "abc", employeeNumber: 42, firstName: "A", lastName: "B", employmentDateData: { hireDate: "2020-01-01" }, status: "Active" }, 7);
    expect(e).toMatchObject({ paycorEmployeeId: "abc", employeeNumber: "42", status: "active", hireDate: "2020-01-01", legalEntityId: 7, isMock: false });
  });
  it("normalizes status", () => {
    expect(normalizeStatus("Terminated")).toBe("terminated");
    expect(normalizeStatus("Inactive")).toBe("inactive");
    expect(normalizeStatus("Leave of Absence")).toBe("leave");
    expect(normalizeStatus(undefined)).toBe("unknown");
  });
});
