import { describe, expect, it } from "vitest";
import { assertCanWrite, OwnershipViolation, ownerOf } from "@/lib/ownership";

describe("data ownership", () => {
  it("lets Paycor write Paycor-owned fields", () => {
    expect(() => assertCanWrite("paycor", ["status", "firstName", "homeFacility"])).not.toThrow();
  });
  it("blocks AOD from writing employee status", () => {
    expect(() => assertCanWrite("aod", ["status"])).toThrow(OwnershipViolation);
  });
  it("blocks Paycor from writing punches or regional pool", () => {
    expect(() => assertCanWrite("paycor", ["punchIn"])).toThrow(OwnershipViolation);
    expect(() => assertCanWrite("paycor", ["regionalPool"])).toThrow(OwnershipViolation);
  });
  it("knows owners", () => {
    expect(ownerOf("punchOut")).toBe("aod");
    expect(ownerOf("regionalPool")).toBe("snf_workforce");
  });
});
