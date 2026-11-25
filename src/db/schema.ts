/**
 * GoldwaterShiftHQ database schema (PostgreSQL, Drizzle ORM).
 *
 * Conventions
 *  - UUID primary keys everywhere. Paycor IDs are separate columns, never PKs.
 *  - Column names are snake_case in the database (drizzle `casing: "snake_case"`).
 *  - All instants are timestamptz (UTC). Facility-local dates use `date`.
 *  - Nothing historical is hard-deleted; status columns are used instead.
 *  - Constraints Drizzle can't express (exclusion constraints, triggers,
 *    append-only audit) live in drizzle/*_constraints.sql.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid().primaryKey().defaultRandom();
const ts = () => timestamp({ withTimezone: true });
const timestamps = {
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
};
const actorCols = {
  createdBy: uuid(),
  updatedBy: uuid(),
};

/* ------------------------------------------------------------------ enums */

export const userStatus = pgEnum("user_status", ["invited", "active", "disabled"]);
export const scopeType = pgEnum("scope_type", ["organization", "facility", "department", "pool"]);
export const employmentStatus = pgEnum("employment_status", ["active", "inactive", "terminated", "leave"]);
export const employmentType = pgEnum("employment_type", ["full_time", "part_time", "prn", "temporary", "unknown"]);
export const recordSource = pgEnum("record_source", ["paycor", "aod", "manual", "demo"]);
export const credentialStatus = pgEnum("credential_status", ["pending_verification", "verified", "expired", "revoked"]);
export const availabilityKind = pgEnum("availability_kind", ["available", "unavailable", "preferred"]);
export const scheduleStatus = pgEnum("schedule_status", ["draft", "published", "archived"]);
export const shiftSource = pgEnum("shift_source", ["budget", "manual", "callout"]);
export const shiftStatus = pgEnum("shift_status", ["active", "cancelled"]);
export const assignmentStatus = pgEnum("assignment_status", ["assigned", "cancelled", "called_out", "swapped_out", "completed"]);
export const assignmentVia = pgEnum("assignment_via", ["scheduler", "marketplace", "swap", "callout", "auto"]);
export const listingStatus = pgEnum("listing_status", ["scheduled", "open", "filled", "withdrawn", "expired"]);
export const claimStatus = pgEnum("claim_status", ["pending", "approved", "auto_approved", "rejected", "cancelled", "withdrawn"]);
export const waitlistStatus = pgEnum("waitlist_status", ["waiting", "offered", "claimed", "removed"]);
export const swapStatus = pgEnum("swap_status", ["pending_peer", "pending_manager", "approved", "rejected", "cancelled"]);
export const calloutStatus = pgEnum("callout_status", ["open", "covered", "uncovered", "cancelled"]);
export const ruleOutcome = pgEnum("rule_outcome", ["warning", "approval_required", "hard_block"]);
export const ruleType = pgEnum("rule_type", [
  "max_weekly_hours",
  "max_daily_hours",
  "max_consecutive_days",
  "min_rest_hours",
  "overlapping_shifts",
  "facility_authorization",
  "credential_required",
  "position_qualification",
  "availability",
  "employment_classification",
]);
export const workflowType = pgEnum("workflow_type", ["marketplace_claim", "shift_swap", "rule_override", "callout_coverage", "manual_assignment"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "cancelled"]);
export const notificationChannel = pgEnum("notification_channel", ["in_app", "email", "sms", "push"]);
export const notificationStatus = pgEnum("notification_status", ["pending", "sent", "failed", "read"]);
export const actorType = pgEnum("actor_type", ["user", "system", "integration"]);
export const integrationProvider = pgEnum("integration_provider", ["paycor", "aod"]);
export const integrationEnvironment = pgEnum("integration_environment", ["mock", "sandbox", "production", "test", "file"]);
export const connectionStatus = pgEnum("connection_status", ["not_configured", "pending_authorization", "connected", "needs_attention", "disconnected"]);
export const syncStatus = pgEnum("sync_status", ["running", "success", "partial", "failed"]);
export const syncTrigger = pgEnum("sync_trigger", ["manual", "scheduled", "system"]);

/* ------------------------------------------------------------- identity */

export const organizations = pgTable("organizations", {
  id: id(),
  name: text().notNull(),
  defaultTimezone: text().notNull().default("America/New_York"),
  ...timestamps,
});

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    email: text().notNull(),
    displayName: text().notNull(),
    passwordHash: text(),
    employeeId: uuid().references(() => employees.id),
    status: userStatus().notNull().default("invited"),
    lastLoginAt: ts(),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: ts(),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
    ...actorCols,
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_employee_uq").on(t.employeeId).where(sql`${t.employeeId} is not null`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id),
    tokenHash: text().notNull().unique(),
    expiresAt: ts().notNull(),
    lastSeenAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id),
    tokenHash: text().notNull().unique(),
    expiresAt: ts().notNull(),
    acceptedAt: ts(),
    revokedAt: ts(),
    invitedBy: uuid().references(() => users.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("invitations_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text().primaryKey(),
  windowStart: ts().notNull(),
  count: integer().notNull().default(0),
});

export const permissions = pgTable("permissions", {
  key: text().primaryKey(),
  category: text().notNull(),
  description: text().notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    /** The broadest scope this role is normally granted at (guides the UI). */
    defaultScope: scopeType().notNull().default("facility"),
    isSystem: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [unique("roles_org_key_uq").on(t.organizationId, t.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid().notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text().notNull().references(() => permissions.key),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id),
    roleId: uuid().notNull().references(() => roles.id),
    scopeType: scopeType().notNull(),
    facilityId: uuid().references(() => facilities.id),
    departmentId: uuid().references(() => departments.id),
    grantedBy: uuid().references(() => users.id),
    revokedAt: ts(),
    ...timestamps,
  },
  (t) => [
    index("user_roles_user_idx").on(t.userId),
    uniqueIndex("user_roles_active_uq")
      .on(t.userId, t.roleId, t.scopeType, t.facilityId, t.departmentId)
      .where(sql`${t.revokedAt} is null`),
    check(
      "user_roles_scope_ck",
      sql`(${t.scopeType} in ('organization','pool') and ${t.facilityId} is null and ${t.departmentId} is null)
       or (${t.scopeType} = 'facility' and ${t.facilityId} is not null and ${t.departmentId} is null)
       or (${t.scopeType} = 'department' and ${t.facilityId} is not null and ${t.departmentId} is not null)`,
    ),
  ],
);

/* --------------------------------------------------- organization structure */

export const facilities = pgTable(
  "facilities",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    name: text().notNull(),
    code: text().notNull(),
    addressLine1: text(),
    addressLine2: text(),
    city: text(),
    state: text(),
    postalCode: text(),
    phone: text(),
    timezone: text().notNull(),
    licensedBeds: integer(),
    isActive: boolean().notNull().default(true),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
    ...actorCols,
  },
  (t) => [unique("facilities_org_code_uq").on(t.organizationId, t.code), index("facilities_org_idx").on(t.organizationId)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    facilityId: uuid().notNull().references(() => facilities.id),
    name: text().notNull(),
    code: text(),
    isClinical: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
    ...actorCols,
  },
  (t) => [unique("departments_facility_name_uq").on(t.facilityId, t.name)],
);

export const units = pgTable(
  "units",
  {
    id: id(),
    facilityId: uuid().notNull().references(() => facilities.id),
    departmentId: uuid().notNull().references(() => departments.id),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
    ...actorCols,
  },
  (t) => [unique("units_department_name_uq").on(t.departmentId, t.name)],
);

/** Organization-wide job classifications (RN, LPN, CNA, ...). */
export const positions = pgTable(
  "positions",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    code: text().notNull(),
    name: text().notNull(),
    isClinical: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("positions_org_code_uq").on(t.organizationId, t.code)],
);

export const facilityPositions = pgTable(
  "facility_positions",
  {
    facilityId: uuid().notNull().references(() => facilities.id),
    positionId: uuid().notNull().references(() => positions.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.positionId] })],
);

export const credentialTypes = pgTable(
  "credential_types",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    code: text().notNull(),
    name: text().notNull(),
    requiresExpiration: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("credential_types_org_code_uq").on(t.organizationId, t.code)],
);

export const positionCredentialRequirements = pgTable(
  "position_credential_requirements",
  {
    positionId: uuid().notNull().references(() => positions.id),
    credentialTypeId: uuid().notNull().references(() => credentialTypes.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.positionId, t.credentialTypeId] })],
);

/* ------------------------------------------------------------- employees */

export const employees = pgTable(
  "employees",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    paycorEmployeeId: text(),
    paycorLegalEntityId: text(),
    employeeNumber: text(),
    badgeNumber: text(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    preferredName: text(),
    email: text(),
    mobilePhone: text(),
    employmentStatus: employmentStatus().notNull().default("active"),
    employmentType: employmentType().notNull().default("unknown"),
    hireDate: date(),
    terminationDate: date(),
    /** Null for regional pool employees (no mandatory home facility). */
    homeFacilityId: uuid().references(() => facilities.id),
    homeDepartmentId: uuid().references(() => departments.id),
    isRegionalPool: boolean().notNull().default(false),
    /** Raw organizational values from Paycor, kept for mapping/reconciliation. */
    paycorPosition: text(),
    paycorDepartment: text(),
    paycorLocation: text(),
    paycorEmploymentClass: text(),
    source: recordSource().notNull().default("manual"),
    sourceHash: text(),
    lastSyncedAt: ts(),
    statusChangedAt: ts(),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
    ...actorCols,
  },
  (t) => [
    uniqueIndex("employees_paycor_uq").on(t.organizationId, t.paycorEmployeeId).where(sql`${t.paycorEmployeeId} is not null`),
    index("employees_org_status_idx").on(t.organizationId, t.employmentStatus),
    index("employees_home_facility_idx").on(t.homeFacilityId),
    index("employees_number_idx").on(t.organizationId, t.employeeNumber),
    index("employees_name_idx").on(sql`lower(${t.lastName})`, sql`lower(${t.firstName})`),
  ],
);

export const employeeFacilityAuthorizations = pgTable(
  "employee_facility_authorizations",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id),
    facilityId: uuid().notNull().references(() => facilities.id),
    effectiveFrom: date(),
    effectiveTo: date(),
    reason: text(),
    authorizedBy: uuid().references(() => users.id),
    revokedAt: ts(),
    revokedBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("efa_active_uq").on(t.employeeId, t.facilityId).where(sql`${t.revokedAt} is null`),
    index("efa_facility_idx").on(t.facilityId),
  ],
);

export const employeePositions = pgTable(
  "employee_positions",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id),
    positionId: uuid().notNull().references(() => positions.id),
    isPrimary: boolean().notNull().default(false),
    source: recordSource().notNull().default("manual"),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    ...timestamps,
  },
  (t) => [
    unique("employee_positions_uq").on(t.employeeId, t.positionId),
    uniqueIndex("employee_positions_primary_uq").on(t.employeeId).where(sql`${t.isPrimary}`),
  ],
);

export const employeeCredentials = pgTable(
  "employee_credentials",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id),
    credentialTypeId: uuid().notNull().references(() => credentialTypes.id),
    /** Optional; store only what verification requires. */
    identifier: text(),
    issuingState: text(),
    issuedOn: date(),
    expiresOn: date(),
    status: credentialStatus().notNull().default("pending_verification"),
    verifiedBy: uuid().references(() => users.id),
    verifiedAt: ts(),
    ...timestamps,
  },
  (t) => [index("employee_credentials_emp_idx").on(t.employeeId)],
);

/**
 * Pay rates are RESTRICTED (permission `pay.view`). Not populated until the
 * owner approves importing pay data (docs/architecture.md, decision A1).
 */
export const employeePayRates = pgTable(
  "employee_pay_rates",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id),
    hourlyRate: numeric({ precision: 10, scale: 2 }).notNull(),
    /** 'hourly' | 'salary' as reported by Paycor; salary is converted to an hourly equivalent. */
    payType: text().notNull().default("hourly"),
    description: text(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    source: recordSource().notNull(),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("employee_pay_rates_emp_idx").on(t.employeeId, t.effectiveFrom),
    uniqueIndex("employee_pay_rates_current_uq").on(t.employeeId).where(sql`${t.effectiveTo} is null`),
  ],
);

export const employeeAvailability = pgTable(
  "employee_availability",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id),
    kind: availabilityKind().notNull(),
    /** Recurring weekly entry (0=Sunday) OR a specific date. */
    dayOfWeek: smallint(),
    specificDate: date(),
    startTime: time(),
    endTime: time(),
    shiftTemplateId: uuid().references(() => shiftTemplates.id),
    facilityId: uuid().references(() => facilities.id),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    index("employee_availability_emp_idx").on(t.employeeId),
    check("availability_when_ck", sql`(${t.dayOfWeek} is not null) <> (${t.specificDate} is not null)`),
    check("availability_dow_ck", sql`${t.dayOfWeek} is null or ${t.dayOfWeek} between 0 and 6`),
  ],
);

export const employeePreferences = pgTable("employee_preferences", {
  employeeId: uuid().primaryKey().references(() => employees.id),
  maxWeeklyHours: numeric({ precision: 5, scale: 2 }),
  preferredShiftTemplateCodes: text().array().notNull().default(sql`'{}'::text[]`),
  preferredFacilityIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  ...timestamps,
});

/* ------------------------------------------------------------- scheduling */

export const shiftTemplates = pgTable(
  "shift_templates",
  {
    id: id(),
    facilityId: uuid().notNull().references(() => facilities.id),
    code: text().notNull(),
    name: text().notNull(),
    /** Facility-local wall-clock times. end < start means it ends next day. */
    startTime: time().notNull(),
    endTime: time().notNull(),
    unpaidBreakMinutes: integer().notNull().default(0),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    ...timestamps,
    ...actorCols,
  },
  (t) => [unique("shift_templates_facility_code_uq").on(t.facilityId, t.code)],
);

export const staffingBudgetTemplates = pgTable(
  "staffing_budget_templates",
  {
    id: id(),
    facilityId: uuid().notNull().references(() => facilities.id),
    departmentId: uuid().references(() => departments.id),
    name: text().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    isActive: boolean().notNull().default(true),
    copiedFromId: uuid(),
    ...timestamps,
    ...actorCols,
  },
  (t) => [index("budget_templates_facility_idx").on(t.facilityId)],
);

export const staffingBudgetRequirements = pgTable(
  "staffing_budget_requirements",
  {
    id: id(),
    templateId: uuid().notNull().references(() => staffingBudgetTemplates.id, { onDelete: "cascade" }),
    unitId: uuid().references(() => units.id),
    positionId: uuid().notNull().references(() => positions.id),
    shiftTemplateId: uuid().notNull().references(() => shiftTemplates.id),
    dayOfWeek: smallint().notNull(),
    requiredCount: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    unique("budget_req_uq").on(t.templateId, t.unitId, t.positionId, t.shiftTemplateId, t.dayOfWeek).nullsNotDistinct(),
    check("budget_req_dow_ck", sql`${t.dayOfWeek} between 0 and 6`),
    check("budget_req_count_ck", sql`${t.requiredCount} >= 0`),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    facilityId: uuid().notNull().references(() => facilities.id),
    departmentId: uuid().references(() => departments.id),
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
    status: scheduleStatus().notNull().default("draft"),
    publishedAt: ts(),
    publishedBy: uuid().references(() => users.id),
    ...timestamps,
    ...actorCols,
  },
  (t) => [
    index("schedules_facility_period_idx").on(t.facilityId, t.periodStart),
    unique("schedules_facility_dept_period_uq").on(t.facilityId, t.departmentId, t.periodStart).nullsNotDistinct(),
    check("schedules_period_ck", sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/** One budgeted (or manual/callout) need: position x shift x date with N openings. */
export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    scheduleId: uuid().references(() => schedules.id),
    facilityId: uuid().notNull().references(() => facilities.id),
    departmentId: uuid().references(() => departments.id),
    unitId: uuid().references(() => units.id),
    positionId: uuid().notNull().references(() => positions.id),
    shiftTemplateId: uuid().references(() => shiftTemplates.id),
    workDate: date().notNull(),
    startsAt: ts().notNull(),
    endsAt: ts().notNull(),
    paidHours: numeric({ precision: 5, scale: 2 }).notNull(),
    requiredCount: integer().notNull(),
    source: shiftSource().notNull().default("budget"),
    budgetRequirementId: uuid().references(() => staffingBudgetRequirements.id),
    status: shiftStatus().notNull().default("active"),
    notes: text(),
    ...timestamps,
    ...actorCols,
  },
  (t) => [
    index("shifts_facility_start_idx").on(t.facilityId, t.startsAt),
    index("shifts_schedule_idx").on(t.scheduleId),
    check("shifts_time_ck", sql`${t.endsAt} > ${t.startsAt}`),
    check("shifts_required_ck", sql`${t.requiredCount} >= 0`),
  ],
);

export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: id(),
    shiftId: uuid().notNull().references(() => shifts.id),
    employeeId: uuid().notNull().references(() => employees.id),
    facilityId: uuid().notNull().references(() => facilities.id),
    /** Denormalized from the shift so the overlap exclusion constraint works. */
    startsAt: ts().notNull(),
    endsAt: ts().notNull(),
    status: assignmentStatus().notNull().default("assigned"),
    assignedVia: assignmentVia().notNull(),
    assignedBy: uuid().references(() => users.id),
    approvedBy: uuid().references(() => users.id),
    ruleEvaluation: jsonb(),
    cancelledAt: ts(),
    cancelledBy: uuid().references(() => users.id),
    cancelReason: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("assignments_active_uq").on(t.shiftId, t.employeeId).where(sql`${t.status} = 'assigned'`),
    index("assignments_employee_start_idx").on(t.employeeId, t.startsAt),
    index("assignments_shift_idx").on(t.shiftId),
    check("assignments_time_ck", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/* ------------------------------------------------------------- marketplace */

export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: id(),
    shiftId: uuid().notNull().references(() => shifts.id),
    facilityId: uuid().notNull().references(() => facilities.id),
    openings: integer().notNull(),
    status: listingStatus().notNull().default("open"),
    publishAt: ts().notNull().defaultNow(),
    expiresAt: ts(),
    requiresApproval: boolean().notNull().default(false),
    incentiveText: text(),
    incentiveAmount: numeric({ precision: 10, scale: 2 }),
    audience: jsonb().notNull().default(sql`'{}'::jsonb`),
    publishedBy: uuid().references(() => users.id),
    withdrawnBy: uuid().references(() => users.id),
    withdrawnAt: ts(),
    ...timestamps,
  },
  (t) => [
    index("listings_status_publish_idx").on(t.status, t.publishAt, t.expiresAt),
    index("listings_facility_idx").on(t.facilityId, t.status),
    uniqueIndex("listings_one_live_per_shift_uq").on(t.shiftId).where(sql`${t.status} in ('scheduled','open')`),
    check("listings_openings_ck", sql`${t.openings} > 0`),
  ],
);

export const shiftClaims = pgTable(
  "shift_claims",
  {
    id: id(),
    listingId: uuid().notNull().references(() => marketplaceListings.id),
    shiftId: uuid().notNull().references(() => shifts.id),
    employeeId: uuid().notNull().references(() => employees.id),
    status: claimStatus().notNull().default("pending"),
    ruleEvaluation: jsonb(),
    assignmentId: uuid().references(() => shiftAssignments.id),
    decidedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    decisionReason: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("claims_active_uq").on(t.listingId, t.employeeId).where(sql`${t.status} in ('pending','approved','auto_approved')`),
    index("claims_employee_idx").on(t.employeeId, t.status),
    index("claims_listing_idx").on(t.listingId, t.status),
  ],
);

export const shiftWaitlists = pgTable(
  "shift_waitlists",
  {
    id: id(),
    shiftId: uuid().notNull().references(() => shifts.id),
    employeeId: uuid().notNull().references(() => employees.id),
    status: waitlistStatus().notNull().default("waiting"),
    ...timestamps,
  },
  (t) => [uniqueIndex("waitlist_active_uq").on(t.shiftId, t.employeeId).where(sql`${t.status} in ('waiting','offered')`)],
);

export const shiftSwapRequests = pgTable("shift_swap_requests", {
  id: id(),
  requesterEmployeeId: uuid().references(() => employees.id),
  requesterAssignmentId: uuid().notNull().references(() => shiftAssignments.id),
  targetEmployeeId: uuid().notNull().references(() => employees.id),
  targetAssignmentId: uuid().references(() => shiftAssignments.id),
  status: swapStatus().notNull().default("pending_peer"),
  note: text(),
  ruleEvaluation: jsonb(),
  peerRespondedAt: ts(),
  decidedBy: uuid().references(() => users.id),
  decidedAt: ts(),
  decisionReason: text(),
  ...timestamps,
});

export const callouts = pgTable(
  "callouts",
  {
    id: id(),
    assignmentId: uuid().notNull().references(() => shiftAssignments.id),
    /** Denormalized for queries (copied from the assignment). */
    shiftId: uuid().references(() => shifts.id),
    facilityId: uuid().references(() => facilities.id),
    reportedBy: uuid().references(() => users.id),
    reason: text(),
    status: calloutStatus().notNull().default("open"),
    /** 0 = home facility staff notified; 1 = widened to cross-facility/pool staff; 2 = leadership alerted. */
    escalationLevel: integer().notNull().default(0),
    escalatedAt: ts(),
    listingId: uuid().references(() => marketplaceListings.id),
    resolvedAt: ts(),
    ...timestamps,
  },
  (t) => [index("callouts_status_idx").on(t.status, t.facilityId), uniqueIndex("callouts_assignment_uq").on(t.assignmentId)],
);

/**
 * Marketplace behaviour. One organization-wide row (facilityId null) plus
 * optional per-facility rows that replace it.
 */
export const marketplaceSettings = pgTable(
  "marketplace_settings",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    facilityId: uuid().references(() => facilities.id),
    /** Automatically publish unfilled shifts of published schedules. */
    autoPublish: boolean().notNull().default(false),
    autoPublishHoursBefore: integer().notNull().default(72),
    /** Listings close this many hours before the shift starts (0 = at start). */
    expiryHoursBefore: integer().notNull().default(2),
    /** Every claim needs a reviewer, even when the rules engine is happy. */
    requireApproval: boolean().notNull().default(false),
    /** Minutes an uncovered callout waits before escalating to level 1, then level 2. */
    escalationMinutes: integer().array().notNull().default(sql`'{30,60}'::integer[]`),
    ...timestamps,
    ...actorCols,
  },
  (t) => [
    unique("marketplace_settings_scope_uq").on(t.organizationId, t.facilityId).nullsNotDistinct(),
    check("marketplace_settings_hours_ck", sql`${t.autoPublishHoursBefore} between 1 and 720 and ${t.expiryHoursBefore} between 0 and 72`),
  ],
);

/* ------------------------------------------------------ rules & workflow */

export const overtimeRules = pgTable("overtime_rules", {
  id: id(),
  organizationId: uuid().notNull().references(() => organizations.id),
  facilityId: uuid().references(() => facilities.id),
  name: text().notNull(),
  weeklyThresholdHours: numeric({ precision: 5, scale: 2 }),
  dailyThresholdHours: numeric({ precision: 5, scale: 2 }),
  warningAtHours: numeric({ precision: 5, scale: 2 }),
  workweekStartDay: smallint().notNull().default(0),
  outcome: ruleOutcome().notNull().default("approval_required"),
  overridable: boolean().notNull().default(true),
  appliesToEmploymentTypes: text().array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean().notNull().default(true),
  /** Must be confirmed by the owner (legal/contract). */
  confirmedBy: uuid().references(() => users.id),
  confirmedAt: ts(),
  ...timestamps,
  ...actorCols,
});

export const schedulingRules = pgTable(
  "scheduling_rules",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    facilityId: uuid().references(() => facilities.id),
    ruleType: ruleType().notNull(),
    name: text().notNull(),
    params: jsonb().notNull().default(sql`'{}'::jsonb`),
    outcome: ruleOutcome().notNull(),
    overridable: boolean().notNull().default(false),
    overridePermission: text(),
    priority: integer().notNull().default(100),
    isActive: boolean().notNull().default(true),
    confirmedBy: uuid().references(() => users.id),
    confirmedAt: ts(),
    ...timestamps,
    ...actorCols,
  },
  (t) => [index("scheduling_rules_scope_idx").on(t.organizationId, t.facilityId)],
);

export const approvalWorkflows = pgTable("approval_workflows", {
  id: id(),
  organizationId: uuid().notNull().references(() => organizations.id),
  facilityId: uuid().references(() => facilities.id),
  workflowType: workflowType().notNull(),
  autoApprove: boolean().notNull().default(false),
  approverPermission: text().notNull(),
  conditions: jsonb().notNull().default(sql`'{}'::jsonb`),
  isActive: boolean().notNull().default(true),
  ...timestamps,
  ...actorCols,
});

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    workflowId: uuid().references(() => approvalWorkflows.id),
    workflowType: workflowType().notNull(),
    facilityId: uuid().references(() => facilities.id),
    subjectType: text().notNull(),
    subjectId: uuid().notNull(),
    employeeId: uuid().references(() => employees.id),
    /** What is being requested (e.g. the assignment) plus the rule evaluation snapshot. */
    payload: jsonb(),
    requestedBy: uuid().references(() => users.id),
    status: approvalStatus().notNull().default("pending"),
    decidedBy: uuid().references(() => users.id),
    decidedAt: ts(),
    decisionReason: text(),
    ...timestamps,
  },
  (t) => [index("approval_requests_pending_idx").on(t.facilityId, t.status)],
);

export const ruleOverrides = pgTable("rule_overrides", {
  id: id(),
  ruleId: uuid().references(() => schedulingRules.id),
  /** A scheduling rule type, or "overtime" / "employee_active". */
  ruleType: text().notNull(),
  subjectType: text().notNull(),
  subjectId: uuid().notNull(),
  employeeId: uuid().references(() => employees.id),
  explanation: text().notNull(),
  overriddenBy: uuid().notNull().references(() => users.id),
  createdAt: ts().notNull().defaultNow(),
}, (t) => [check("rule_overrides_explanation_ck", sql`length(trim(${t.explanation})) >= 5`)]);

/* --------------------------------------------------- time & integrations */

export const timekeepingRecords = pgTable(
  "timekeeping_records",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    source: recordSource().notNull(),
    externalId: text().notNull(),
    externalEmployeeKey: text(),
    employeeId: uuid().references(() => employees.id),
    facilityId: uuid().references(() => facilities.id),
    externalFacility: text(),
    workDate: date().notNull(),
    punchIn: ts(),
    punchOut: ts(),
    hours: numeric({ precision: 6, scale: 2 }),
    approved: boolean(),
    syncLogId: uuid(),
    isDemo: boolean().notNull().default(false),
    importedAt: ts().notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("timekeeping_source_external_uq").on(t.organizationId, t.source, t.externalId),
    index("timekeeping_employee_date_idx").on(t.employeeId, t.workDate),
  ],
);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    provider: integrationProvider().notNull(),
    environment: integrationEnvironment().notNull(),
    /** Paycor legal entity (tokens are per legal entity). Null for AOD. */
    legalEntityId: text(),
    displayName: text().notNull(),
    status: connectionStatus().notNull().default("not_configured"),
    accessTokenEnc: text(),
    refreshTokenEnc: text(),
    tokenExpiresAt: ts(),
    authorizedBy: uuid().references(() => users.id),
    authorizedAt: ts(),
    lastTestAt: ts(),
    lastTestOk: boolean(),
    lastTestMessage: text(),
    lastSuccessAt: ts(),
    lastFailureAt: ts(),
    lastError: text(),
    isEnabled: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("integration_connections_uq").on(t.organizationId, t.provider, t.environment, t.legalEntityId).nullsNotDistinct()],
);

export const integrationSyncLogs = pgTable(
  "integration_sync_logs",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    connectionId: uuid().references(() => integrationConnections.id),
    provider: integrationProvider().notNull(),
    environment: integrationEnvironment().notNull(),
    syncType: text().notNull(),
    trigger: syncTrigger().notNull(),
    status: syncStatus().notNull().default("running"),
    startedAt: ts().notNull().defaultNow(),
    finishedAt: ts(),
    recordsReceived: integer().notNull().default(0),
    recordsCreated: integer().notNull().default(0),
    recordsUpdated: integer().notNull().default(0),
    recordsUnchanged: integer().notNull().default(0),
    recordsDeactivated: integer().notNull().default(0),
    recordsSkipped: integer().notNull().default(0),
    errorCount: integer().notNull().default(0),
    errorSummary: text(),
    details: jsonb(),
    initiatedBy: uuid().references(() => users.id),
  },
  (t) => [index("sync_logs_provider_started_idx").on(t.organizationId, t.provider, t.startedAt)],
);

export const integrationFieldMappings = pgTable(
  "integration_field_mappings",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    provider: integrationProvider().notNull(),
    /** 'location' | 'department' | 'legal_entity' | 'position' */
    sourceType: text().notNull(),
    sourceValue: text().notNull(),
    facilityId: uuid().references(() => facilities.id),
    departmentId: uuid().references(() => departments.id),
    positionId: uuid().references(() => positions.id),
    ...timestamps,
    ...actorCols,
  },
  (t) => [unique("integration_mappings_uq").on(t.organizationId, t.provider, t.sourceType, t.sourceValue, t.facilityId).nullsNotDistinct()],
);

/* ------------------------------------------------------------ cross-cutting */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    userId: uuid().references(() => users.id),
    employeeId: uuid().references(() => employees.id),
    channel: notificationChannel().notNull().default("in_app"),
    category: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    data: jsonb(),
    status: notificationStatus().notNull().default("pending"),
    sentAt: ts(),
    readAt: ts(),
    failureReason: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_employee_idx").on(t.employeeId, t.createdAt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid().notNull().references(() => users.id),
    category: text().notNull(),
    channel: notificationChannel().notNull(),
    enabled: boolean().notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.category, t.channel] })],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid().notNull().references(() => organizations.id),
    actorType: actorType().notNull(),
    actorUserId: uuid().references(() => users.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    facilityId: uuid().references(() => facilities.id),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_created_idx").on(t.organizationId, t.createdAt),
    index("audit_facility_idx").on(t.facilityId, t.createdAt),
  ],
);
