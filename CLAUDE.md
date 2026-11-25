# CLAUDE.md: project memory for GoldwaterShiftHQ

Read this first. It carries everything from earlier sessions. Keep it updated at the end of each session.

## The project
- **What:** an enterprise workforce scheduling platform ("ShiftHQ", internally "SNF Workforce") for an organization running **11 skilled nursing facilities**, built to scale beyond 11. Production quality, not a prototype.
- **Design bar:** Apple-like. Simple and minimal for end users, sophisticated behind the scenes. Every screen has one obvious primary action.
- **Owner:** not a software developer. Explain everything in plain English. Guide them interactively, one small step at a time: what to click, what they should see, then ask them to confirm. Never pretend to see a screen. **Never ask them to paste passwords, client secrets or tokens into chat.**
- **Branch:** work on `claude/clever-maxwell-1f0fvt` (it holds all the code). Commit and push there.

## The original brief (summary; the owner provided it in full in session 1)
- **Sections 1–20, the master build prompt:**
  - **Stack:** Next.js, TypeScript, Tailwind, shadcn-style components, PostgreSQL.
  - **Roles:** Corporate Admin, Regional Director, Facility Admin, Director of Nursing, Scheduler, Department Manager, Pool Manager, Employee.
  - **Modules:** Paycor as system of record, budget-based scheduling, open-shift marketplace, regional pool, overtime/rules engine (warning / approval required / hard block, with overrides that require an explanation), mobile PWA, notifications, analytics, audit, security.
  - **Process:** build in 6 phases with 20 acceptance criteria. Don't invent APIs. Clearly label demo data. Never write to Paycor without explicit authorization. Don't hard-code facilities.
- **Section 21, Paycor + Attendance on Demand (AOD) setup:** hands-on guidance for the owner, a data ownership matrix, employee matching, timekeeping reconciliation, secure credentials, an integration dashboard, and mock integrations while vendor access is pending.

Detailed docs live in `docs/architecture.md`, `docs/progress.md` and `docs/integrations/`.

## Status
- **Phase 1 (foundation): done.** Schema, auth, role-based access, facilities, employees, Paycor/AOD on Postgres, audit, PWA shell.
- **Phase 2 (scheduling): done.** Budget editor, schedule generation (DST-safe), weekly drag-and-drop board, rules engine, approvals and overrides, cross-facility hours, Settings → Rules, employee availability, restricted pay rates.
- **73 tests pass** (`npm test`). Acceptance criteria covered so far: 1, 2, 3, 4, 5, 9, 10, 12, 15, 16, 17, 18, 20.
- **Next: Phase 3 (marketplace).** Publish open shifts (single, bulk, scheduled, automatic, expiring, withdraw), the employee "Pick Up" tab with one-tap claims (same rules engine plus atomic assignment), claim approvals, waitlists, swaps, callouts with escalation, and notifications (in-app first; email/SMS/push behind providers). Then Phase 4 (regional pool dashboard), Phase 5 (reporting and exports), Phase 6 (hardening, including RLS).

## Owner decisions (don't re-ask)
- **A1, pay rates: APPROVED for import.** Store only the base hourly rate (salary ÷ 2,080), restricted to `pay.view` (Corporate Admin). Live import is gated by `PAYCOR_IMPORT_PAY_RATES=true` until the endpoint and scope are confirmed in the portal.
- **A2, overtime and labor rules:** the owner will confirm later in Settings → Rules. Defaults are EXAMPLES and stay "unconfirmed" until then.
- **A3:** employees missing from a Paycor feed are never auto-deactivated.
- **A4:** future assignments of terminated employees are kept and flagged; pending claims and waitlist entries are cancelled.

## Owner's answers about vendors
- **Paycor:** the owner *thinks* they're a client admin; they were asked to confirm with their Paycor rep. **12 legal entities** (with 11 facilities; mapping handles this). The developer portal signup (Guide 02, Step 2) is the next owner action.
- **AOD:** billed by a **third-party reseller**, which is the first contact for integration. The email template is `docs/integrations/04-aod-vendor-email.md`. The owner is unsure whether AOD hours already flow into Paycor; they'll ask payroll.
- **Network:** the owner tried to allow `developers.paycor.com` and `attendanceondemand.com` in the environment's network settings. As of the end of session 1 both were still blocked (proxy 403). **First thing in a new session:** run `curl -s -o /dev/null -w "%{http_code}" https://developers.paycor.com/`. If it works, read the Paycor guides and API reference and verify the unconfirmed items below.

## Unverified integration details (verify when docs are reachable)
- Paycor token URL `https://apis.paycor.com/sts/v1/common/token`; sandbox host (`apis.paycor.com` vs `apis-sandbox.paycor.com`); endpoints `/v1/legalentities/{id}`, `/v1/legalentities/{id}/employees`, `/v1/employees/{id}/payrates`; employee and pay field names; paging (`continuationToken`); scopes; rate limits.
- AOD: CC1 SOAP over HTTPS port 8192 with an Access Account is documented. The exact punch and employee extraction methods for this account are unknown, so live SOAP sync stays disabled until AOD confirms. CSV export import (`AOD_MODE=file`) works.

## How to run
```bash
npm install
cp .env.example .env.local
npm run seed:demo
npm run dev
```
- `npm run dev` uses an embedded Postgres (PGlite) in `./data`, so nothing needs installing.
- Demo logins use the `@demo.test` emails with password `Demo-Password-2026`; all accounts are listed on the login page.
- Production: set `DATABASE_URL`, then `npm run db:migrate` and `npm run bootstrap`.

## Engineering conventions
- Business logic lives in `src/server/*` (server-only). Pages call services, and every service checks permissions via `src/server/rbac/access.ts` and writes `audit()` in the same transaction.
- The database enforces integrity (`drizzle/0001_constraints.sql`): an overlap exclusion constraint, a capacity trigger with a row lock, active-employee checks, no deletes of employees or assignments, and an append-only audit log. Don't weaken these.
- Migrations: change `src/db/schema.ts`, then run `npm run db:generate`. Never edit already-applied migrations.
- Demo data is flagged `is_demo` and shown with a banner. The seed refuses to run when `APP_ENV=production`.
- Use the existing UI components in `src/components/ui`. Review new screens in a browser (Playwright is preinstalled) before calling them done.
- Don't put model identifiers in commits or code.
