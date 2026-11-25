/**
 * Builds a complete DEMONSTRATION organization. Every row is flagged is_demo
 * and the UI shows a "Demonstration data" banner. Employees are imported
 * through the real Paycor sync pipeline using the demo Paycor source, so the
 * demo exercises the same code path as production.
 *
 * Refuses to run when APP_ENV=production.
 */
import { and, asc, eq, gt, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/db";
import {
  credentialTypes,
  departments,
  employeeCredentials,
  employeeFacilityAuthorizations,
  employeePositions,
  employees,
  facilities,
  facilityPositions,
  integrationFieldMappings,
  organizations,
  positionCredentialRequirements,
  positions,
  shiftTemplates,
  staffingBudgetRequirements,
  staffingBudgetTemplates,
  units,
  userRoles,
  users,
} from "@/db/schema";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { DemoAodSource } from "@/server/integrations/aod/demo";
import { syncAodTimekeeping } from "@/server/integrations/aod/sync";
import { DemoPaycorSource } from "@/server/integrations/paycor/demo";
import { syncPaycorEmployees } from "@/server/integrations/paycor/sync";
import { seedDefaultRoles } from "./base";
import { seedDefaultRules } from "./rules";
import {
  DEMO_BUDGET,
  DEMO_CREDENTIAL_TYPES,
  DEMO_DEPARTMENTS,
  DEMO_FACILITIES,
  DEMO_ORG,
  DEMO_POOL_LOCATION,
  DEMO_POSITIONS,
  DEMO_SHIFT_TEMPLATES,
} from "./demo-org";

export const DEMO_PASSWORD_DEFAULT = "Demo-Password-2026";

export interface DemoUser {
  email: string;
  name: string;
  role: string;
  scope: "organization" | "facility" | "department" | "pool";
  facilityCodes?: string[];
  department?: string;
  linkEmployee?: boolean;
}

export const DEMO_USERS: DemoUser[] = [
  { email: "corporate@demo.test", name: "Corey Corporate", role: "corporate_admin", scope: "organization" },
  { email: "regional@demo.test", name: "Regina Regional", role: "regional_director", scope: "facility", facilityCodes: ["MGR", "CRK", "OKH", "WLW"] },
  { email: "administrator@demo.test", name: "Adam Administrator", role: "facility_admin", scope: "facility", facilityCodes: ["MGR"] },
  { email: "don@demo.test", name: "Dana Nursing", role: "director_of_nursing", scope: "facility", facilityCodes: ["MGR"] },
  { email: "scheduler@demo.test", name: "Sam Scheduler", role: "scheduler", scope: "facility", facilityCodes: ["MGR"] },
  { email: "manager@demo.test", name: "Morgan Manager", role: "department_manager", scope: "department", facilityCodes: ["MGR"], department: "Dietary" },
  { email: "pool@demo.test", name: "Paula Pool", role: "pool_manager", scope: "pool" },
  { email: "employee@demo.test", name: "", role: "employee", scope: "organization", linkEmployee: true },
];

export async function seedDemo(db: Db, opts: { password?: string; now?: Date; schedules?: boolean } = {}) {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to load demonstration data: APP_ENV=production.");
  const [existing] = await db.select().from(organizations).where(eq(organizations.name, DEMO_ORG.name));
  if (existing) return { organizationId: existing.id, created: false };

  const [org] = await db.insert(organizations).values({ name: DEMO_ORG.name, defaultTimezone: DEMO_ORG.timezone }).returning();
  const orgId = org.id;
  const roleIds = await seedDefaultRoles(db, orgId);
  await seedDefaultRules(db, orgId);
  const ctx = { organizationId: orgId, actorType: "system" as const };

  // Classifications and credentials
  const posRows = await db
    .insert(positions)
    .values(DEMO_POSITIONS.map((p, i) => ({ organizationId: orgId, code: p.code, name: p.name, isClinical: p.isClinical, sortOrder: i + 1 })))
    .returning();
  const posByCode = new Map(posRows.map((p) => [p.code, p]));
  const credRows = await db
    .insert(credentialTypes)
    .values(DEMO_CREDENTIAL_TYPES.map((c) => ({ organizationId: orgId, code: c.code, name: c.name })))
    .returning();
  for (const c of DEMO_CREDENTIAL_TYPES) {
    const ct = credRows.find((r) => r.code === c.code)!;
    await db.insert(positionCredentialRequirements).values(c.positions.map((code) => ({ positionId: posByCode.get(code)!.id, credentialTypeId: ct.id })));
  }

  // Facilities, departments, units, shift templates, budgets, mappings
  const facilityByCode = new Map<string, typeof facilities.$inferSelect>();
  for (const f of DEMO_FACILITIES) {
    const [fac] = await db
      .insert(facilities)
      .values({ organizationId: orgId, name: f.name, code: f.code, addressLine1: `${100 + f.beds} Demonstration Way`, city: f.city, state: f.state, postalCode: f.postalCode, timezone: f.timezone, licensedBeds: f.beds, isDemo: true })
      .returning();
    facilityByCode.set(f.code, fac);
    const depts = await db
      .insert(departments)
      .values(DEMO_DEPARTMENTS.map((d, i) => ({ facilityId: fac.id, name: d.name, code: d.code, isClinical: d.isClinical, sortOrder: i + 1 })))
      .returning();
    const nursing = depts.find((d) => d.name === "Nursing")!;
    const unitNames = ["East Wing", "West Wing", ...(f.memoryCare ? ["Memory Care"] : [])];
    await db.insert(units).values(unitNames.map((name, i) => ({ facilityId: fac.id, departmentId: nursing.id, name, sortOrder: i + 1 })));
    await db.insert(facilityPositions).values(posRows.map((p) => ({ facilityId: fac.id, positionId: p.id })));
    const templates = await db
      .insert(shiftTemplates)
      .values(DEMO_SHIFT_TEMPLATES.map((t, i) => ({ facilityId: fac.id, ...t, sortOrder: i + 1 })))
      .returning();
    const [budget] = await db
      .insert(staffingBudgetTemplates)
      .values({ facilityId: fac.id, departmentId: nursing.id, name: "Nursing – standard week", effectiveFrom: "2026-01-01" })
      .returning();
    const reqs: (typeof staffingBudgetRequirements.$inferInsert)[] = [];
    for (const t of templates) for (const [code, n] of Object.entries(DEMO_BUDGET[t.code] ?? {})) for (let dow = 0; dow < 7; dow++) {
      reqs.push({ templateId: budget.id, positionId: posByCode.get(code)!.id, shiftTemplateId: t.id, dayOfWeek: dow, requiredCount: n });
    }
    await db.insert(staffingBudgetRequirements).values(reqs);
    await db.insert(integrationFieldMappings).values({ organizationId: orgId, provider: "paycor", sourceType: "location", sourceValue: f.paycorLocation, facilityId: fac.id });
    for (const d of DEMO_DEPARTMENTS) {
      if (d.paycorName !== d.name) {
        await db.insert(integrationFieldMappings).values({ organizationId: orgId, provider: "paycor", sourceType: "department", sourceValue: d.paycorName, facilityId: fac.id, departmentId: depts.find((x) => x.name === d.name)!.id });
      }
    }
  }
  for (const p of DEMO_POSITIONS) {
    if (p.paycorTitle.toLowerCase() !== p.name.toLowerCase()) {
      await db.insert(integrationFieldMappings).values({ organizationId: orgId, provider: "paycor", sourceType: "position", sourceValue: p.paycorTitle, positionId: posByCode.get(p.code)!.id });
    }
  }

  // Employees arrive through the real sync pipeline (demo source).
  const sync = await syncPaycorEmployees(db, { organizationId: orgId, source: new DemoPaycorSource(), trigger: "system" });
  if (!sync.ok) throw new Error(`Demo Paycor sync failed: ${sync.message}`);

  // Regional pool: classify pool-location employees and authorize facilities.
  const allFacilities = [...facilityByCode.values()];
  const poolEmps = await db.select().from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.paycorLocation, DEMO_POOL_LOCATION), eq(employees.employmentStatus, "active")));
  for (const [i, e] of poolEmps.entries()) {
    await db.update(employees).set({ isRegionalPool: true }).where(eq(employees.id, e.id));
    await audit(db, ctx, { action: "employee.pool_added", entityType: "employee", entityId: e.id, reason: "Demonstration setup" });
    const count = 4 + (i % 5);
    for (let k = 0; k < count; k++) {
      const fac = allFacilities[(i * 3 + k) % allFacilities.length];
      await db.insert(employeeFacilityAuthorizations).values({ employeeId: e.id, facilityId: fac.id, reason: "Regional pool eligibility (demonstration)" });
    }
  }
  // A few cross-facility authorizations for regular staff.
  const mgr = facilityByCode.get("MGR")!;
  const crk = facilityByCode.get("CRK")!;
  const crossTrain = await db.select().from(employees).where(and(eq(employees.homeFacilityId, crk.id), eq(employees.employmentStatus, "active"))).limit(3);
  for (const e of crossTrain) await db.insert(employeeFacilityAuthorizations).values({ employeeId: e.id, facilityId: mgr.id, reason: "Cross-trained for Maple Grove (demonstration)" });

  // Credentials for active clinical staff.
  const reqRows = await db.select().from(positionCredentialRequirements);
  const empPos = await db
    .select({ employeeId: employeePositions.employeeId, positionId: employeePositions.positionId })
    .from(employeePositions)
    .innerJoin(employees, eq(employees.id, employeePositions.employeeId))
    .where(and(eq(employees.organizationId, orgId), eq(employeePositions.isPrimary, true)));
  let k = 0;
  const creds: (typeof employeeCredentials.$inferInsert)[] = [];
  for (const ep of empPos) {
    for (const r of reqRows.filter((x) => x.positionId === ep.positionId)) {
      k++;
      const expiring = k % 17 === 0;
      creds.push({
        employeeId: ep.employeeId,
        credentialTypeId: r.credentialTypeId,
        issuingState: "OH",
        issuedOn: "2024-06-01",
        expiresOn: expiring ? "2026-12-15" : "2027-12-31",
        status: k % 23 === 0 ? "pending_verification" : "verified",
        verifiedAt: k % 23 === 0 ? null : new Date("2025-01-15"),
      });
    }
  }
  for (let i = 0; i < creds.length; i += 500) await db.insert(employeeCredentials).values(creds.slice(i, i + 500));

  // Demo users
  const passwordHash = await hashPassword(opts.password ?? process.env.DEMO_PASSWORD ?? DEMO_PASSWORD_DEFAULT);
  const [demoEmployee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.homeFacilityId, mgr.id), eq(employees.employmentStatus, "active"), eq(employees.paycorPosition, "Certified Nursing Assistant"), isNotNull(employees.employeeNumber)))
    .limit(1);
  for (const u of DEMO_USERS) {
    const employeeId = u.linkEmployee ? demoEmployee.id : null;
    const displayName = u.linkEmployee ? `${demoEmployee.firstName} ${demoEmployee.lastName}` : u.name;
    const [user] = await db.insert(users).values({ organizationId: orgId, email: u.email, displayName, passwordHash, status: "active", employeeId, isDemo: true }).returning();
    const facIds = u.facilityCodes?.map((c) => facilityByCode.get(c)!.id) ?? [null];
    for (const facilityId of facIds) {
      let departmentId: string | null = null;
      if (u.scope === "department" && facilityId) {
        departmentId = (await db.select().from(departments).where(and(eq(departments.facilityId, facilityId), eq(departments.name, u.department!))))[0].id;
      }
      await db.insert(userRoles).values({ userId: user.id, roleId: roleIds[u.role], scopeType: u.scope, facilityId: u.scope === "facility" || u.scope === "department" ? facilityId : null, departmentId });
    }
  }

  // Timekeeping (demo AOD feed) for the last week.
  const roster = await db
    .select({ employeeNumber: employees.employeeNumber, firstName: employees.firstName, lastName: employees.lastName, location: employees.paycorLocation, status: employees.employmentStatus })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), isNotNull(employees.employeeNumber)));
  await syncAodTimekeeping(db, {
    organizationId: orgId,
    trigger: "system",
    source: new DemoAodSource(
      roster.filter((r) => r.location && r.status !== "leave").map((r) => ({ employeeNumber: r.employeeNumber!, firstName: r.firstName, lastName: r.lastName, location: r.location!, active: r.status === "active" })),
      opts.now,
    ),
  });

  if (opts.schedules !== false) {
    await seedDemoSchedules(db, orgId, facilityByCode.get("MGR")!.id);
    await seedDemoMarketplace(db, orgId, facilityByCode.get("MGR")!.id);
  }

  return { organizationId: orgId, created: true };
}

/**
 * Builds this week's and next week's schedule for one facility and fills
 * roughly 80% of openings THROUGH THE RULES ENGINE (nothing bypasses it), so
 * the demo shows realistic partial coverage.
 */
async function seedDemoSchedules(db: Db, orgId: string, facilityId: string) {
  const { loadActor } = await import("@/server/rbac/access");
  const { ensureWeek, normalizeWeek } = await import("@/server/scheduling/schedules");
  const { assignEmployee } = await import("@/server/scheduling/assignments");
  const { addDaysStr } = await import("@/lib/tz");
  const [corpUser] = await db.select().from(users).where(eq(users.email, "corporate@demo.test"));
  const actor = (await loadActor(db, corpUser.id))!;
  const ctx = { organizationId: orgId, actorUserId: actor.userId, actorType: "system" as const };
  const [fac] = await db.select().from(facilities).where(eq(facilities.id, facilityId));
  const thisWeek = normalizeWeek(undefined, fac.timezone);
  const staff = await db
    .select({ id: employees.id, positionId: employeePositions.positionId })
    .from(employees)
    .innerJoin(employeePositions, eq(employeePositions.employeeId, employees.id))
    .where(and(eq(employees.homeFacilityId, facilityId), eq(employees.employmentStatus, "active"), eq(employeePositions.isPrimary, true)));
  const { shifts } = await import("@/db/schema");
  let k = 0;
  for (const week of [thisWeek, addDaysStr(thisWeek, 7)]) {
    const { schedule } = await ensureWeek(db, actor, ctx, facilityId, week);
    const weekShifts = (await db.select().from(shifts).where(eq(shifts.scheduleId, schedule.id))).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    for (const s of weekShifts) {
      const pool = staff.filter((e) => e.positionId === s.positionId);
      for (let slot = 0; slot < s.requiredCount; slot++) {
        if ((k++ * 7) % 10 >= 8) continue; // leave ~20% open
        for (let tries = 0; tries < pool.length; tries++) {
          const e = pool[(k + tries) % pool.length];
          const r = await assignEmployee(db, actor, ctx, { shiftId: s.id, employeeId: e.id, via: "auto" }).catch(() => null);
          if (r?.status === "assigned") break;
        }
      }
    }
  }
}

/**
 * Demonstration marketplace activity at one facility, created through the
 * real services: a handful of published open shifts (one with an incentive),
 * one that reviews every pick-up and that the demo employee has requested,
 * and a callout that has been posted for coverage.
 */
async function seedDemoMarketplace(db: Db, orgId: string, facilityId: string) {
  const { loadActor } = await import("@/server/rbac/access");
  const { publishOpenShifts, unfilledShifts } = await import("@/server/marketplace/listings");
  const { claimShift } = await import("@/server/marketplace/claims");
  const { recordCallout } = await import("@/server/marketplace/callouts");
  const { marketplaceListings, positions, shiftAssignments, shifts } = await import("@/db/schema");
  const [corpUser] = await db.select().from(users).where(eq(users.email, "corporate@demo.test"));
  const [empUser] = await db.select().from(users).where(eq(users.email, "employee@demo.test"));
  const corp = (await loadActor(db, corpUser.id))!;
  const emp = (await loadActor(db, empUser.id))!;
  const ctx = { organizationId: orgId, actorUserId: corp.userId };
  const soon = new Date(Date.now() + 6 * 3_600_000);
  const open = (await unfilledShifts(db, corp, facilityId, 10)).filter((s) => s.startsAt > soon);
  const pick = [...open.filter((s) => s.positionCode === "CNA").slice(0, 5), ...open.filter((s) => s.positionCode !== "CNA").slice(0, 4)];
  if (!pick.length) return;
  await publishOpenShifts(db, corp, ctx, { shiftIds: pick.slice(1).map((s) => s.id) });
  if (pick[2]) await db.update(marketplaceListings).set({ incentiveText: "$5/hr weekend bonus" }).where(eq(marketplaceListings.shiftId, pick[2].id));
  const review = await publishOpenShifts(db, corp, ctx, { shiftIds: [pick[0].id], requiresApproval: true });
  if (review.listingIds[0]) await claimShift(db, emp, { organizationId: orgId, actorUserId: emp.userId }, review.listingIds[0]).catch(() => null);

  // A callout on an upcoming CNA shift (not the demo employee's).
  const [cna] = await db.select().from(positions).where(and(eq(positions.organizationId, orgId), eq(positions.code, "CNA")));
  const later = new Date(Date.now() + 12 * 3_600_000);
  const [target] = await db
    .select({ id: shiftAssignments.id, employeeId: shiftAssignments.employeeId })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .where(and(eq(shiftAssignments.facilityId, facilityId), eq(shiftAssignments.status, "assigned"), eq(shifts.positionId, cna.id), gt(shiftAssignments.startsAt, later), ne(shiftAssignments.employeeId, emp.employeeId!)))
    .orderBy(asc(shiftAssignments.startsAt))
    .limit(1);
  if (target) await recordCallout(db, corp, ctx, target.id, "Called in sick (demonstration)").catch(() => null);
}
