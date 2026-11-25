-- Row-level security: tenant isolation enforced by the database itself.
--
-- The application connects as a LOGIN role that is a member of `shifthq_app`.
-- `app_tenant_roles` maps that login role to exactly one organization. Every
-- policy below compares rows with `app_org_id()`, which is derived from
-- `current_user`, so the application cannot widen its own access (it has no
-- write access to the mapping and no setting it could change).
--
-- The database owner (migrations, bootstrap, backups) is not a member of
-- `shifthq_app`, so these policies don't apply to it. A login role with no
-- mapping sees nothing at all (fail closed).
--
-- Not tenant-scoped on purpose: `permissions` (the global permission catalog)
-- and `rate_limits` (sign-in throttling keyed by hashed email/IP).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shifthq_app') THEN
    CREATE ROLE shifthq_app NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL; -- created at the same moment by another migration run (roles are server-wide)
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_tenant_roles (
  role_name text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT organization_id FROM app_tenant_roles WHERE role_name = current_user $$;
--> statement-breakpoint

-- Least privilege for the application role.
GRANT USAGE ON SCHEMA public TO shifthq_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shifthq_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON app_tenant_roles FROM shifthq_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs FROM shifthq_app;
--> statement-breakpoint
REVOKE DELETE ON employees, shift_assignments, organizations FROM shifthq_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_id() TO shifthq_app;
--> statement-breakpoint

DO $$
DECLARE
  t text;
  -- table -> boolean expression that is true for rows of the current tenant
  rules text[][] := ARRAY[
    ['organizations',                    'id = app_org_id()'],
    -- tables with organization_id
    ['approval_workflows',               'organization_id = app_org_id()'],
    ['audit_logs',                       'organization_id = app_org_id()'],
    ['credential_types',                 'organization_id = app_org_id()'],
    ['employees',                        'organization_id = app_org_id()'],
    ['facilities',                       'organization_id = app_org_id()'],
    ['integration_connections',          'organization_id = app_org_id()'],
    ['integration_field_mappings',       'organization_id = app_org_id()'],
    ['integration_sync_logs',            'organization_id = app_org_id()'],
    ['marketplace_settings',             'organization_id = app_org_id()'],
    ['notifications',                    'organization_id = app_org_id()'],
    ['overtime_rules',                   'organization_id = app_org_id()'],
    ['positions',                        'organization_id = app_org_id()'],
    ['roles',                            'organization_id = app_org_id()'],
    ['scheduling_rules',                 'organization_id = app_org_id()'],
    ['timekeeping_records',              'organization_id = app_org_id()'],
    ['users',                            'organization_id = app_org_id()'],
    -- through the facility
    ['approval_requests',                'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id()) OR EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['callouts',                         'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['departments',                      'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['facility_positions',               'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['marketplace_listings',             'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['schedules',                        'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['shift_assignments',                'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['shift_templates',                  'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['shifts',                           'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['staffing_budget_templates',        'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    ['units',                            'EXISTS (SELECT 1 FROM facilities f WHERE f.id = facility_id AND f.organization_id = app_org_id())'],
    -- through the employee
    ['employee_availability',            'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['employee_credentials',             'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['employee_facility_authorizations', 'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['employee_pay_rates',               'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['employee_positions',               'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['employee_preferences',             'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['rule_overrides',                   'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['shift_claims',                     'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['shift_waitlists',                  'EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.organization_id = app_org_id())'],
    ['shift_swap_requests',              'EXISTS (SELECT 1 FROM employees e WHERE e.id = target_employee_id AND e.organization_id = app_org_id())'],
    -- through the user
    ['invitations',                      'EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.organization_id = app_org_id())'],
    ['notification_preferences',         'EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.organization_id = app_org_id())'],
    ['sessions',                         'EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.organization_id = app_org_id())'],
    ['user_roles',                       'EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.organization_id = app_org_id())'],
    -- other parents
    ['role_permissions',                 'EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.organization_id = app_org_id())'],
    ['staffing_budget_requirements',     'EXISTS (SELECT 1 FROM staffing_budget_templates b JOIN facilities f ON f.id = b.facility_id WHERE b.id = template_id AND f.organization_id = app_org_id())'],
    ['position_credential_requirements', 'EXISTS (SELECT 1 FROM positions p WHERE p.id = position_id AND p.organization_id = app_org_id())']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(rules, 1) LOOP
    t := rules[i][1];
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I AS PERMISSIVE FOR ALL TO shifthq_app USING (%s) WITH CHECK (%s)', t, rules[i][2], rules[i][2]);
  END LOOP;
END $$;
--> statement-breakpoint

-- Tables created by future migrations get the same grants automatically;
-- a test (tests/rls.test.ts) fails if any tenant table is left without a policy.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shifthq_app;
