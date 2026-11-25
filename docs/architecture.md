# GoldwaterShiftHQ: architecture & roadmap

SNF Workforce Management & Scheduling Platform. One application, one shared database, and several experiences determined by permissions.

## 1. Repository inspection (start of Phase 1)

| Found | Decision |
|---|---|
| Next.js 15 + TypeScript app containing only the Paycor / Attendance on Demand integration layer (OAuth, sync, mock data, matching, exception reports, setup guides) | **Kept and moved onto PostgreSQL.** Its logic (OAuth, defensive field mapping, AOD SOAP/CSV, matching, exceptions) is reused; the JSON-file store and basic-auth gate are replaced |
| No database, auth, or scheduling code | Built in Phase 1 (this document) |

## 2. Architecture

```
                         ┌──────────────────────────── Vercel (or equivalent) ───────────────────────────┐
 Browser / PWA  ───────► │ Next.js App Router                                                            │
 (desktop + mobile)      │  ├─ Server Components: all data reads happen on the server                    │
                         │  ├─ Server Actions: every write; validated with zod, authorized, audited      │
                         │  ├─ Route handlers: OAuth callback, cron sync, CSV upload                     │
                         │  └─ Domain services (src/server/*): auth, RBAC, facilities, employees,        │
                         │       integrations (Paycor, AOD), audit, notifications, rules engine (Ph. 2)  │
                         └───────────────────────────────┬───────────────────────────────────────────────┘
                                                         │ TLS
                                        ┌────────────────▼───────────────┐      ┌───────────────────────┐
                                        │ Managed PostgreSQL              │      │ Paycor Public API      │
                                        │ (Supabase / Neon / RDS)         │      │ AOD Web Services / SFTP│
                                        │ constraints · triggers · audit  │      └───────────────────────┘
                                        └─────────────────────────────────┘
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui-pattern components (Radix primitives + `class-variance-authority`) | As specified. Components live in `src/components/ui` and are owned by us, the same way shadcn/ui works |
| Server | Next.js Server Components and Server Actions; domain services in `src/server` | Secrets, employee data, and business rules never reach the browser. `server-only` imports make that a build error |
| Database | PostgreSQL via **Drizzle ORM** with SQL migrations | Typed queries; migrations live in git; raw SQL where Postgres features matter (exclusion constraints, triggers) |
| Local / test DB | **PGlite** (real PostgreSQL compiled to WebAssembly), used automatically when `DATABASE_URL` is unset | The owner runs `npm run dev` with nothing to install, and tests run against real Postgres semantics (constraints, triggers, `btree_gist`) |
| Production DB | Any managed Postgres. **Supabase is recommended** (managed Postgres, point-in-time backups) | Set `DATABASE_URL`; no code change |
| Authentication | In-app: scrypt password hashes, server-side session table, HTTP-only cookies, invitation links tied to an existing employee record, login rate limiting | Works identically locally and in production. RBAC and facility scoping are enforced in one server-side layer. **Microsoft Entra ID SSO** (the organization uses Microsoft 365) can be added for corporate/facility staff later |
| Authorization | Permission catalog → roles → user role assignments **scoped** to organization, facility, department, or pool | Granular and configurable; roles are data, not code |
| Row-level security | **Phase 6**: Postgres RLS policies keyed on `app.user_id` set per transaction, as defense in depth | Phase 1 enforces scope in the data-access layer, with tests |
| Hosting | Vercel + Vercel Cron for scheduled Paycor sync | `vercel.json` |
| Monitoring / logging | Structured JSON logger (`src/server/log.ts`); Sentry DSN hook in Phase 6 | |
| Mobile | Mobile-first responsive **PWA** (manifest + service worker). Employee UI uses a bottom tab bar | Domain services are UI-agnostic, so a React Native app can call the same server API later |

### Key engineering rules
- **Time**: all instants are stored as `timestamptz` (UTC). Each facility has an IANA `timezone`, and schedules display in the facility's local time. `work_date` is the facility-local date.
- **IDs**: UUID primary keys everywhere. `employees.paycor_employee_id` is a separate, unique, nullable column and is never a primary key.
- **History**: employees and assignments are never hard-deleted. Deactivation is a status change.
- **Concurrency**: claims and assignments run in transactions. The database itself refuses to overfill a shift (capacity trigger with row lock) and refuses overlapping assignments for one employee (GiST exclusion constraint).
- **Audit**: every write calls `audit()` inside the same transaction. `audit_logs` is append-only (a trigger blocks UPDATE/DELETE).
- **Demo data**: rows created by the seed are flagged `is_demo`, and the UI shows a **Demonstration data** banner. The seed refuses to run when `APP_ENV=production`.

## 3. Database schema

All tables have `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, and `created_by` / `updated_by` where a user acts. Full definitions: `src/db/schema.ts`. Hand-written constraints: `drizzle/0001_constraints.sql`.

**Identity & access**
- `organizations`
- `users` (email, password_hash, employee_id → employees, status, lockout)
- `sessions`
- `invitations`
- `roles`
- `permissions`
- `role_permissions`
- `user_roles` (role + scope_type ∈ {organization, facility, department, pool} + facility_id / department_id)
- `rate_limits`

**Organization structure**
- `facilities` (address, timezone, code, is_active)
- `departments` (facility)
- `units` (department)
- `positions` (org-wide job classifications: RN, LPN, CNA…)
- `facility_positions` (which classifications a facility uses)
- `credential_types`
- `position_credential_requirements`

**Employees**
- `employees` (internal id, `paycor_employee_id`, `paycor_legal_entity_id`, employee_number, names, contact, `employment_status`, `employment_type` {full_time, part_time, prn, …}, hire/termination dates, `home_facility_id` (nullable, since pool employees have none), home department, `is_regional_pool`, raw Paycor org strings, `is_demo`)
- `employee_facility_authorizations` (cross-facility / pool approval, with effective dates and revocation)
- `employee_positions`
- `employee_credentials`
- `employee_availability`
- `employee_preferences`
- `employee_pay_rates` (**restricted; not populated until approved**, see §6)

**Scheduling** (tables created in Phase 1; features in Phase 2)
- `shift_templates` (facility, local start/end time, paid hours)
- `staffing_budget_templates` (facility / department / unit, effective dates)
- `staffing_budget_requirements` (template × unit × position × shift template × day_of_week → required_count; unique)
- `schedules` (facility, department, period, draft/published)
- `shifts` (one row per facility / department / unit / position / shift / date with `required_count`; `starts_at` / `ends_at` timestamptz; source = budget / manual / callout)
- `shift_assignments` (shift × employee, denormalized start/end, status; **exclusion constraint** against overlap, **capacity trigger** against overfill, unique active assignment per shift and employee)

**Marketplace** (Phase 3)
- `marketplace_listings` (openings, publish_at, expires_at, status, incentive, approval requirement)
- `shift_claims` (unique active claim per listing and employee; rule evaluation snapshot)
- `shift_waitlists`
- `shift_swap_requests`
- `callouts`

**Rules & workflow**
- `overtime_rules` (org or facility scope, thresholds, workweek start, outcome)
- `scheduling_rules` (rule_type, params jsonb, outcome ∈ {warning, approval_required, hard_block}, overridable, scope)
- `approval_workflows`
- `approval_requests`
- `rule_overrides` (explanation required)

**Time & integration**
- `timekeeping_records` (source, external_id unique per source, employee link nullable, punches, hours, approved)
- `integration_connections` (provider, environment, legal entity, encrypted tokens, status)
- `integration_sync_logs` (counts, status, errors, trigger)
- `integration_field_mappings` (Paycor location/department → facility/department)

**Cross-cutting**
- `notifications`
- `notification_preferences`
- `audit_logs` (append-only)

**Indexes:**
- employees by (organization, status), home facility, employee_number, Paycor ID
- shifts by (facility, starts_at) and (schedule)
- assignments by (employee, starts_at)
- listings by (status, publish_at, expires_at)
- audit by (entity) and (created_at)

## 4. Navigation

**Staff (desktop-first)**: left sidebar. Items appear only when permitted.

| Item | Who | Phase |
|---|---|---|
| Overview | Corporate, Regional, Facility admins | 1 (basic) → 5 (analytics) |
| Schedule | Schedulers, DON, Dept managers, Facility admins | 2 |
| Open Shifts (publish, review pick-ups and swaps, callouts) | Schedulers, DON, Facility admins (anyone with a marketplace permission) | 3 ✓ |
| Regional Pool | Pool manager, Corporate (all facilities); Regional director and facility leaders with `pool.view` (their facilities) | 4 ✓ |
| Employees | All staff roles (scoped) | 1 |
| Facilities | Corporate admin (all); facility admins see their own | 1 |
| Reports | Corporate, Regional, Facility admins | 5 |
| Settings → Users & Access · Roles · Rules · Marketplace · Integrations · Audit log | Corporate admin (Marketplace: also facility admins/schedulers for their facility) | 1 (Rules: 2, Marketplace: 3) |

**Employee (mobile-first PWA)**: bottom tab bar with four destinations plus Home:
**Home** (next shift, upcoming shifts, available shifts, pending requests, notifications) · **My Schedule** · **Pick Up Shifts** · **My Availability** · **My Profile**.

A user who is both staff and an employee can switch between the two experiences from the account menu.

## 5. Paycor integration prerequisites

1. Paycor developer portal access (https://developers.paycor.com/), which requires Paycor approval.
2. An AppCreator application: client ID, client secret (expires every 365 days), APIm **subscription key** (separate sandbox and production keys).
3. The app scope name plus `offline_access` (for refresh tokens).
4. A registered redirect URL: `{APP_BASE_URL}/api/integrations/paycor/callback`, added in AppCreator → Security Connections as an "Approved Return OAuth URL" (no query string allowed).
5. A Paycor Perform **Company/Payroll/HR admin** must activate the app **for each legal entity** (several legal entities of the same company can be ticked at once). Tokens are issued per legal entity. The sign-in uses PKCE (S256); the one-time code expires in 10 minutes.
6. Minimum read-only data access: legal entity, employee identity/demographics, employment status and dates, position/job, department, work location. Pay rates **only if approved** (see §6).
7. Sandbox testing before production. A sandbox account is requested through the portal's Support form (category "Sandbox Environment"); Paycor quotes about 5 business days.

Step-by-step owner guide: `docs/integrations/02-paycor-setup.md`.

## 6. Unknowns, limitations, and decisions needing approval

| # | Item | Status |
|---|---|---|
| U1 | Exact Paycor endpoint paths, field names, and pagination in **your** account | Employees path and `continuationToken`/`hasMoreResults` paging (max 100) **verified** in Paycor's guides. Legal-entity and pay-rate paths, field names and scopes still to verify in the API reference (blocked host `api.paycor.com`); "Test connection" reports field *names* |
| U2 | Paycor sandbox host (`apis.paycor.com` vs `apis-sandbox.paycor.com`) | Paycor's guide shows it only as an image; still configurable (`PAYCOR_API_BASE_URL`) |
| U3 | Paycor rate limits | **Verified** (developer guides, 2026-11-25): 1,000 calls/minute per app across all APIs. Client throttles to ~240/min, honors `Retry-After`; token POSTs are not retried on 5xx (Paycor's guidance) |
| U4 | Paycor time-punch / timecard endpoints | Not confirmed for your account. Timekeeping is planned via Attendance on Demand; Paycor time data is added only if verified |
| U5 | How "home facility" is represented in Paycor (work location, department, or legal entity) | Mapping table `integration_field_mappings`; unmapped values appear on Reconciliation |
| U6 | AOD integration method and functions | Awaiting vendor (email template prepared) |
| **A1** | **Pay rates.** Store only the current base hourly rate (salary converted at 2,080 h/yr), with history, in a restricted table visible only with `pay.view` (Corporate Admin by default). Audit entries never contain amounts | **Approved by owner.** Live import stays off (`PAYCOR_IMPORT_PAY_RATES`) until the endpoint and scope are confirmed in the portal |
| **A2** | **Overtime / labor rules.** No legal thresholds are hard-coded. Example defaults ship *unconfirmed* (overtime after 40 h/week needs approval, warning at 36, 8 h rest, 16 h/day, 60 h/week cap, overlap always blocked). Schedulers see a reminder until a Corporate Admin confirms them in Settings → Rules | **Owner will confirm later** |
| **A3** | **Employees missing from a Paycor feed are *not* auto-deactivated.** Only an explicit Paycor status change deactivates someone, because a partial or failed feed must never mass-deactivate staff | Decided (safe default) |
| A4 | Future assignments of a newly terminated employee are **kept and flagged** for the scheduler, not auto-cancelled (protects coverage visibility). Pending claims and waitlist entries are cancelled automatically | Decided; kept as is in Phase 3 |

## 7. Roadmap

| Phase | Scope | Acceptance criteria covered |
|---|---|---|
| **1. Foundation** | Architecture, full schema + migrations, auth + invitations, RBAC + scoping, audit log, facility management (facilities, departments, units, classifications, shift templates), employee directory + profiles + facility authorizations, Paycor framework on Postgres (manual + scheduled sync, history, duplicate detection, reconciliation, deactivation handling), PWA shell, demo seed | 1, 2 (status), 15, 16, 17, 20 |
| 2. Scheduling | Staffing budget editor (per-day matrices, template copy between facilities), shift generation from budgets, weekly calendar with drag-and-drop, coverage (4/5), copy week / repeat / multi-week, availability, rules engine (warning / approval / block, overrides with reason), cross-facility hours | 3, 4, 5, 9, 10, 18 |
| **3. Marketplace** | Publishing (single, bulk, scheduled, auto, expiry, withdraw), employee app tabs, claiming with atomic assignment, approval workflows, waitlists, swaps, callouts + escalation, notifications (in-app, email, SMS, push) | 2, 6, 7, 11, 12, 13, 14 |
| **4. Regional pool** | Pool classification, authorizations, consolidated hours, pool dashboard | 8, 9 |
| 5. Reporting | Corporate dashboard, budget vs scheduled vs actual, overtime, fill rate, time-to-fill, exports (CSV/Excel) | 15, 18 |
| 6. Hardening | RLS policies, security review, concurrency load tests, sync failure drills, mobile QA, backups/restore runbook, Sentry | 12, 19, 20 |
