/**
 * Permission catalog and default role definitions.
 *
 * Roles are DATA: these defaults are seeded into `roles`/`role_permissions`
 * and can then be changed by a Corporate Admin in Settings → Roles. Code checks
 * permissions, never role names.
 */
export const PERMISSIONS = {
  // Organization & facilities
  "facilities.view": ["Facilities", "View facilities and their configuration"],
  "facilities.manage": ["Facilities", "Create and edit facilities, departments, units, classifications and shift templates"],
  "positions.manage": ["Facilities", "Manage the organization-wide job classification list"],
  "budgets.view": ["Staffing budgets", "View staffing budgets"],
  "budgets.manage": ["Staffing budgets", "Create, edit and copy staffing budgets"],
  // Scheduling
  "schedules.view": ["Scheduling", "View schedules"],
  "schedules.manage": ["Scheduling", "Build schedules and assign employees"],
  "schedules.publish": ["Scheduling", "Publish schedules"],
  "assignments.approve": ["Scheduling", "Approve assignments that require approval"],
  "marketplace.manage": ["Marketplace", "Publish, withdraw and manage open shifts"],
  "claims.review": ["Marketplace", "Approve or reject shift claims"],
  "callouts.manage": ["Marketplace", "Record callouts and manage coverage"],
  "swaps.approve": ["Marketplace", "Approve shift swaps"],
  // Rules
  "rules.view": ["Rules", "View scheduling and overtime rules"],
  "rules.manage": ["Rules", "Configure scheduling and overtime rules"],
  "rules.override": ["Rules", "Override overridable rules (explanation required)"],
  "exceptions.approve": ["Rules", "Approve authorized staffing exceptions"],
  // Employees
  "employees.view": ["Employees", "View employee directory and profiles"],
  "employees.view_contact": ["Employees", "View employee contact details"],
  "employees.manage": ["Employees", "Edit scheduling-platform employee data (classifications, credentials)"],
  "employees.authorize_facility": ["Employees", "Grant or revoke cross-facility authorizations"],
  "employees.invite": ["Employees", "Invite employees to the mobile app"],
  "credentials.verify": ["Employees", "Verify employee credentials"],
  "pool.view": ["Regional pool", "View the regional staffing pool"],
  "pool.manage": ["Regional pool", "Classify employees into the regional pool and manage pool eligibility"],
  "pay.view": ["Compensation", "View pay rates (restricted)"],
  // Reporting
  "reports.view": ["Reports", "View labor and staffing reports"],
  "reports.export": ["Reports", "Export reports to CSV/Excel"],
  // Administration
  "integrations.view": ["Administration", "View integration status and sync history"],
  "integrations.manage": ["Administration", "Configure integrations and run synchronization"],
  "users.view": ["Administration", "View users and their access"],
  "users.manage": ["Administration", "Invite users and assign roles"],
  "roles.manage": ["Administration", "Change which permissions each role has"],
  "audit.view": ["Administration", "View the audit log"],
  // Employee self-service (always about the signed-in employee's own records)
  "self.schedule": ["Self-service", "View my schedule"],
  "self.marketplace": ["Self-service", "View and claim eligible open shifts"],
  "self.availability": ["Self-service", "Manage my availability"],
  "self.profile": ["Self-service", "View my profile"],
} as const satisfies Record<string, readonly [string, string]>;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const SELF: Permission[] = ["self.schedule", "self.marketplace", "self.availability", "self.profile"];

export interface RoleDefinition {
  key: string;
  name: string;
  description: string;
  defaultScope: "organization" | "facility" | "department" | "pool";
  permissions: Permission[];
}

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    key: "corporate_admin",
    name: "Corporate Admin",
    description: "All facilities. Configuration, budgets, policies, integrations and permissions.",
    defaultScope: "organization",
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("self.") && p !== "pay.view"),
  },
  {
    key: "regional_director",
    name: "Regional Director",
    description: "Assigned facilities. Staffing and labor analytics, shortages, exception approvals.",
    defaultScope: "facility",
    permissions: ["facilities.view", "budgets.view", "schedules.view", "rules.view", "exceptions.approve", "assignments.approve", "employees.view", "pool.view", "reports.view", "reports.export"],
  },
  {
    key: "facility_admin",
    name: "Facility Administrator",
    description: "Full access to an assigned facility.",
    defaultScope: "facility",
    permissions: [
      "facilities.view", "budgets.view", "schedules.view", "schedules.manage", "schedules.publish", "assignments.approve",
      "marketplace.manage", "claims.review", "callouts.manage", "swaps.approve", "rules.view", "rules.override", "exceptions.approve",
      "employees.view", "employees.view_contact", "employees.manage", "employees.invite", "credentials.verify", "pool.view",
      "reports.view", "reports.export", "audit.view",
    ],
  },
  {
    key: "director_of_nursing",
    name: "Director of Nursing",
    description: "Clinical staffing, clinical schedules and assignment approvals.",
    defaultScope: "facility",
    permissions: [
      "facilities.view", "budgets.view", "schedules.view", "schedules.manage", "assignments.approve", "claims.review",
      "callouts.manage", "swaps.approve", "rules.view", "rules.override", "employees.view", "employees.view_contact",
      "credentials.verify", "pool.view", "reports.view",
    ],
  },
  {
    key: "scheduler",
    name: "Scheduler",
    description: "Builds schedules, assigns employees, manages and publishes open shifts, reviews claims.",
    defaultScope: "facility",
    permissions: [
      "facilities.view", "budgets.view", "schedules.view", "schedules.manage", "schedules.publish", "marketplace.manage",
      "claims.review", "callouts.manage", "rules.view", "employees.view", "employees.view_contact", "employees.invite", "pool.view",
    ],
  },
  {
    key: "department_manager",
    name: "Department Manager",
    description: "Assigned departments. Views schedules and manages eligible assignments.",
    defaultScope: "department",
    permissions: ["facilities.view", "schedules.view", "schedules.manage", "rules.view", "employees.view", "employees.view_contact"],
  },
  {
    key: "pool_manager",
    name: "Pool Manager",
    description: "Regional pool employees, cross-facility eligibility and pool assignments.",
    defaultScope: "pool",
    permissions: [
      "facilities.view", "schedules.view", "pool.view", "pool.manage", "employees.view", "employees.view_contact",
      "employees.authorize_facility", "employees.invite", "credentials.verify", "reports.view",
    ],
  },
  {
    key: "employee",
    name: "Employee",
    description: "Own schedule, eligible open shifts, availability and profile only.",
    defaultScope: "organization",
    permissions: SELF,
  },
];

/**
 * Permissions that a department- or pool-scoped grant may use against a
 * facility as a whole (e.g. to see the facility's name), as opposed to
 * records belonging to a specific department/employee.
 */
export const FACILITY_LEVEL_READ: Permission[] = ["facilities.view", "schedules.view", "budgets.view", "rules.view"];
