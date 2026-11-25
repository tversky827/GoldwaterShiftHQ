import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { employees, invitations, sessions, users } from "@/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { acceptInvitation, login, revokeSession, validateSession } from "@/server/auth/service";
import { inviteEmployee } from "@/server/users";
import { actorFor, ctxFor, demoDb } from "./helpers";

let db: Db;
beforeAll(async () => {
  ({ db } = await demoDb());
});

describe("passwords", () => {
  it("hashes with a salt and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await hashPassword("correct horse battery")).not.toBe(h);
  });
  it("enforces a minimum length", () => {
    expect(passwordProblem("short")).toMatch(/10/);
    expect(passwordProblem("long-enough-password")).toBeNull();
  });
});

describe("sessions", () => {
  it("logs in, validates, and revokes; tokens are stored hashed", async () => {
    const { token, userId } = await login(db, "Scheduler@Demo.test", "Test-Password-123", { ipAddress: "1.1.1.1" });
    expect(await validateSession(db, token)).toBe(userId);
    const stored = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(stored.every((s) => s.tokenHash !== token)).toBe(true);
    await revokeSession(db, token);
    expect(await validateSession(db, token)).toBeNull();
  });

  it("uses one generic message for unknown users and wrong passwords", async () => {
    const a = await login(db, "nobody@demo.test", "whatever-123", { ipAddress: "2.2.2.2" }).catch((e) => e.message);
    const b = await login(db, "don@demo.test", "wrong-password", { ipAddress: "2.2.2.2" }).catch((e) => e.message);
    expect(a).toBe(b);
  });

  it("locks an account after repeated failures", async () => {
    for (let i = 0; i < 8; i++) await login(db, "pool@demo.test", `bad-${i}-password`, { ipAddress: `3.3.3.${i}` }).catch(() => null);
    await expect(login(db, "pool@demo.test", "Test-Password-123", { ipAddress: "3.3.3.99" })).rejects.toThrow(/locked/);
  });

  it("rate-limits sign-in attempts per IP", async () => {
    let last: unknown;
    for (let i = 0; i < 31; i++) last = await login(db, `rate${i}@demo.test`, "x-password-1", { ipAddress: "9.9.9.9" }).catch((e) => e);
    expect(String((last as Error).message)).toMatch(/Too many/);
  });
});

describe("employee onboarding", () => {
  it("invites an existing employee, links the account to their employee record, and the link works once", async () => {
    const scheduler = await actorFor(db, "scheduler@demo.test");
    const { rows } = await import("@/server/employees").then((m) => m.listEmployees(db, scheduler, { pageSize: 5 }));
    const target = rows.find((r) => r.employmentStatus === "active")!;
    const { token, userId } = await inviteEmployee(db, scheduler, ctxFor(scheduler), target.id, "new.hire@example.com");
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u.employeeId).toBe(target.id);
    expect(u.status).toBe("invited");
    await expect(acceptInvitation(db, token, "short")).rejects.toThrow(/10/);
    const session = await acceptInvitation(db, token, "a-strong-password-1");
    expect(await validateSession(db, session.token)).toBe(userId);
    await expect(acceptInvitation(db, token, "a-strong-password-2")).rejects.toThrow(/invalid or has expired/);
    const inv = await db.select().from(invitations).where(eq(invitations.userId, userId));
    expect(inv.every((i) => i.tokenHash !== token)).toBe(true);
  });

  it("refuses to invite terminated employees", async () => {
    const corp = await actorFor(db, "corporate@demo.test");
    const [t] = await db.select().from(employees).where(eq(employees.employmentStatus, "terminated")).limit(1);
    await expect(inviteEmployee(db, corp, ctxFor(corp), t.id, "gone@example.com")).rejects.toThrow(/Inactive/);
  });
});
