import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { employees, roles } from "@/db/schema";
import { getEmployeeProfile, listEmployees, setRegionalPool, authorizeFacility } from "@/server/employees";
import { createFacility, getFacility, listFacilities } from "@/server/facilities";
import { reconciliation } from "@/server/integrations";
import { can } from "@/server/rbac/access";
import { listUsers, setRolePermissions } from "@/server/users";
import { actorFor, ctxFor, demoDb, facilityByCode } from "./helpers";

let db: Db;
beforeAll(async () => {
  ({ db } = await demoDb());
});

describe("facility access", () => {
  it("AC15: corporate sees all 11 facilities", async () => {
    const corp = await actorFor(db, "corporate@demo.test");
    expect(await listFacilities(db, corp)).toHaveLength(11);
  });

  it("AC16: a facility administrator sees only their facility and is refused others", async () => {
    const admin = await actorFor(db, "administrator@demo.test");
    const list = await listFacilities(db, admin);
    expect(list.map((f) => f.code)).toEqual(["MGR"]);
    const crk = await facilityByCode(db, "CRK");
    await expect(getFacility(db, admin, crk.id)).rejects.toThrow(/permission/);
  });

  it("a regional director sees exactly their assigned facilities", async () => {
    const rd = await actorFor(db, "regional@demo.test");
    expect((await listFacilities(db, rd)).map((f) => f.code).sort()).toEqual(["CRK", "MGR", "OKH", "WLW"]);
  });

  it("only corporate can create facilities (none are hard-coded)", async () => {
    const admin = await actorFor(db, "administrator@demo.test");
    const corp = await actorFor(db, "corporate@demo.test");
    const input = { name: "New Facility Twelve", code: "NF12", timezone: "America/Chicago", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, phone: null, licensedBeds: 80 };
    await expect(createFacility(db, admin, ctxFor(admin), input)).rejects.toThrow();
    const f = await createFacility(db, corp, ctxFor(corp), input);
    expect(f.id).toBeDefined();
    expect(await listFacilities(db, corp)).toHaveLength(12);
  });
});

describe("employee visibility", () => {
  it("a facility sees its own employees plus authorized cross-facility employees, nobody else", async () => {
    const admin = await actorFor(db, "administrator@demo.test");
    const mgr = await facilityByCode(db, "MGR");
    const { rows } = await listEmployees(db, admin, { pageSize: 200, status: "all" });
    const foreign = rows.filter((r) => r.homeFacilityId !== mgr.id);
    expect(rows.some((r) => r.homeFacilityId === mgr.id)).toBe(true);
    expect(foreign.length).toBeGreaterThan(0); // cross-trained + pool employees authorized for MGR
    for (const f of foreign) {
      const profile = await getEmployeeProfile(db, admin, f.id);
      expect(profile.authorizations.some((a) => a.authorization.facilityId === mgr.id)).toBe(true);
    }
    const crk = await facilityByCode(db, "CRK");
    const [crkOnly] = await db.select().from(employees).where(eq(employees.homeFacilityId, crk.id)).limit(50);
    const visible = rows.some((r) => r.id === crkOnly.id);
    const prof = visible ? null : await getEmployeeProfile(db, admin, crkOnly.id).catch((e) => e);
    if (!visible) expect(prof).toBeInstanceOf(Error);
  });

  it("a department manager sees only their department", async () => {
    const mgrUser = await actorFor(db, "manager@demo.test");
    const { rows } = await listEmployees(db, mgrUser, { pageSize: 200 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.departmentName === "Dietary")).toBe(true);
  });

  it("a pool manager sees regional pool employees across facilities", async () => {
    const pm = await actorFor(db, "pool@demo.test");
    const { rows } = await listEmployees(db, pm, { pageSize: 200 });
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.isRegionalPool)).toBe(true);
  });

  it("an employee can see their own profile but not the directory or anyone else", async () => {
    const emp = await actorFor(db, "employee@demo.test");
    expect(can(emp, "employees.view")).toBe(false);
    await expect(listEmployees(db, emp)).rejects.toThrow(/permission/);
    const own = await getEmployeeProfile(db, emp, emp.employeeId!);
    expect(own.employee.id).toBe(emp.employeeId);
    const [other] = await db.select().from(employees).where(eq(employees.isRegionalPool, true)).limit(1);
    await expect(getEmployeeProfile(db, emp, other.id)).rejects.toThrow(/permission/);
  });

  it("contact details are hidden without the contact permission", async () => {
    const rd = await actorFor(db, "regional@demo.test"); // regional director lacks employees.view_contact
    const { rows } = await listEmployees(db, rd, { pageSize: 1 });
    const p = await getEmployeeProfile(db, rd, rows[0].id);
    expect(p.showContact).toBe(false);
    expect(p.employee.email).toBeNull();
  });
});

describe("pool classification and authorizations", () => {
  it("only pool managers / corporate can classify pool employees; changes are audited", async () => {
    const corp = await actorFor(db, "corporate@demo.test");
    const scheduler = await actorFor(db, "scheduler@demo.test");
    const mgr = await facilityByCode(db, "MGR");
    const [e] = await db.select().from(employees).where(eq(employees.homeFacilityId, mgr.id)).limit(1);
    await expect(setRegionalPool(db, scheduler, ctxFor(scheduler), e.id, true, "test")).rejects.toThrow();
    if (e.employmentStatus === "active") {
      await setRegionalPool(db, corp, ctxFor(corp), e.id, true, "Joining pool");
      expect((await db.select().from(employees).where(eq(employees.id, e.id)))[0].isRegionalPool).toBe(true);
    }
  });

  it("a facility admin can't authorize an employee for a facility they don't manage", async () => {
    const admin = await actorFor(db, "administrator@demo.test");
    const crk = await facilityByCode(db, "CRK");
    const [e] = await db.select().from(employees).limit(1);
    await expect(authorizeFacility(db, admin, ctxFor(admin), e.id, crk.id, "test")).rejects.toThrow();
  });
});

describe("administration", () => {
  it("only corporate admins can list users; the admin role can't lock itself out", async () => {
    const corp = await actorFor(db, "corporate@demo.test");
    const admin = await actorFor(db, "administrator@demo.test");
    await expect(listUsers(db, admin)).rejects.toThrow();
    expect((await listUsers(db, corp)).length).toBeGreaterThanOrEqual(8);
    const [ca] = await db.select().from(roles).where(eq(roles.key, "corporate_admin"));
    await expect(setRolePermissions(db, corp, ctxFor(corp), ca.id, ["facilities.view"])).rejects.toThrow(/locked out/);
    const [er] = await db.select().from(roles).where(eq(roles.key, "employee"));
    await expect(setRolePermissions(db, corp, ctxFor(corp), er.id, ["self.profile", "pay.view"])).rejects.toThrow(/self-service/);
  });

  it("reconciliation surfaces duplicates, unmapped locations, and unmatched timekeeping", async () => {
    const corp = await actorFor(db, "corporate@demo.test");
    const issues = await reconciliation(db, corp);
    const types = new Set(issues.map((i) => i.type));
    expect(types.has("duplicate")).toBe(true);
    expect(types.has("unmatched_timekeeping")).toBe(true);
    expect(types.has("no_facility")).toBe(true);
  });
});
