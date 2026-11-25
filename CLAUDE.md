# CLAUDE.md: project memory for GoldwaterShiftHQ

Read this first. It carries everything from earlier sessions. Keep it updated at the end of each session.

## The project
- **What:** an enterprise workforce scheduling platform ("ShiftHQ", internally "SNF Workforce") for an organization running **11 skilled nursing facilities**, built to scale beyond 11. Production quality, not a prototype.
- **Design bar:** Apple-like. Simple and minimal for end users, sophisticated behind the scenes. Every screen has one obvious primary action.
- **Owner:** not a software developer. Explain everything in plain English. Guide them interactively, one small step at a time: what to click, what they should see, then ask them to confirm. Never pretend to see a screen. **Never ask them to paste passwords, client secrets or tokens into chat.**
- **Branch:** work on `claude/clever-maxwell-1f0fvt` (it holds all the code). Commit and push there. (The session harness may name a different `claude/...` branch; the owner has said to use this one.)

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
- **Phase 3 (marketplace): done (session 4).** Services in `src/server/marketplace/` (listings, claims, swaps, callouts, settings, state, jobs); staff page `/open-shifts`; Settings → Marketplace; employee Pick Up tab, shift detail (`/app/schedule/[id]`: swap, "I can't make it"), Home swap requests. Migration `0006_phase3_marketplace`. Cron `/api/cron/marketplace` every 10 min. Details in `docs/progress.md`.
  - `src/server/marketplace/state.ts#refreshShiftMarket` keeps listings/claims/callouts/waitlists consistent; call it (inside the transaction) after ANY change that fills or frees an opening. `assignments.ts` exports `insertAssignmentTx` / `withFriendlyDbErrors` for this.
  - Email/SMS/push: provider interface only (`src/server/notifications.ts`); owner hasn't picked vendors. In-app works.
- **90 tests pass** (`npm test`), `next build` passes. The roadmap assigns AC 2, 6, 7, 11, 12, 13, 14 to Phase 3, but the acceptance-criteria TEXT isn't stored in the repo, so new tests are named by behaviour, not AC number. Ask the owner to paste the 20 criteria if numbering matters.
- **Next: Phase 4 (regional pool dashboard),** then Phase 5 (reporting and exports), Phase 6 (hardening, including RLS).

## Owner decisions (don't re-ask)
- **A1, pay rates: APPROVED for import.** Store only the base hourly rate (salary ÷ 2,080), restricted to `pay.view` (Corporate Admin). Live import is gated by `PAYCOR_IMPORT_PAY_RATES=true` until the endpoint and scope are confirmed in the portal.
- **A2, overtime and labor rules:** the owner will confirm later in Settings → Rules. Defaults are EXAMPLES and stay "unconfirmed" until then.
- **A3:** employees missing from a Paycor feed are never auto-deactivated.
- **A4:** future assignments of terminated employees are kept and flagged; pending claims and waitlist entries are cancelled.

## Owner's answers about vendors
- **Open owner questions (session 4):** which email/SMS vendors to use for notifications; whether the hosting plan allows a 10-minute cron job.
- **Paycor:** the owner *thinks* they're a client admin; they were asked to confirm with their Paycor rep. **12 legal entities** (with 11 facilities; mapping handles this). The developer portal signup (Guide 02, Step 2) is the next owner action.
- **AOD:** billed by a **third-party reseller**, which is the first contact for integration. The email template is `docs/integrations/04-aod-vendor-email.md`. The owner is unsure whether AOD hours already flow into Paycor; they'll ask payroll.
- **Network:** the owner tried to allow `developers.paycor.com` and `attendanceondemand.com` in the environment's network settings. As of the end of session 1 both were still blocked (proxy 403). **First thing in a new session:** check `curl -s -o /dev/null -w "%{http_code}" https://api.paycor.com/` (the API reference host). If it answers, read the API reference and verify the "still unverified" items below. The guides' text is embedded in the developer-site JS bundle (`/static/js/main.*.chunk.js`), which is how session 4 read them.
- **Session 4 (2026-11-25):** npm registry ✅ and `developers.paycor.com` ✅ now work. Still blocked: `apis.paycor.com`, `api.paycor.com` (where the API reference loads from), `secure.paycor.com`, and `www.attendanceondemand.com`. Goldwater's AOD address is **`goldwater.attendanceondemand.com`** (reachable on 443; `/ess/` is employee self-service). Port **8192** (AOD SOAP) on it resets the connection; the AOD email template now asks about this. To verify the remaining Paycor items, the owner should add `api.paycor.com` to the network allowlist.
- **Session 3 (2026-11-25):** both vendor hosts were still blocked (proxy 403), and so was the npm registry (`registry.npmjs.org` and the mirrors). As a result `npm install` failed, and the tests and the app couldn't run. The owner was asked to fix Network access in the environment settings, with **"Allow package managers" ticked** and the two vendor domains added. Phase 3 work began locally: `ignoreAssignmentIds` in the rules engine and `src/server/notifications.ts`. It was committed as an untested WIP commit, so typecheck and test it first.

## Integration details
**Verified from Paycor's developer guides (developers.paycor.com, session 4)** and reflected in code/docs: `Ocp-Apim-Subscription-Key` header; token service under `/sts/v1/common`; 30-minute access tokens + refresh; scope `"<app scope> offline_access"` (space → `+`, never `%2B`); **PKCE S256 required** (added: verifier derived from the state nonce with the server key); code valid 10 min, single use (exchange never retried); token POSTs not retried on 5xx; one token per legal entity; activation by a Paycor Company/Payroll/HR admin (Error 403 = missing role); redirect URL registered in AppCreator → Security Connections, no query string; client secret expires every 365 days; `/v1/legalentities/{legalEntityId}/employees`; paging with `continuationToken` + `hasMoreResults` (+ `additionalResultsUrl`), max 100/page; rate limit 1,000 calls/min per app across all APIs; sandbox has separate credentials, requested via Support (≈5 business days). "Get Employee Payrates by EmployeeID" and "Get Legal Entity" exist as API names.

**Still unverified** (API reference is on blocked `api.paycor.com`): sandbox API host; exact paths for legal entity and pay rates; employee and pay-rate field names; scope names. AOD: CC1 SOAP over HTTPS port 8192 with an Access Account is documented publicly; exact methods unknown, so live SOAP sync stays disabled until AOD confirms. CSV export import (`AOD_MODE=file`) works.

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
- Use the existing UI components in `src/components/ui`. Review new screens in a browser (Playwright is preinstalled) before calling them done. The demo seed creates marketplace activity at Maple Grove (MGR): open listings, one pending claim by `employee@demo.test`, one callout. The demo employee is near 40 h, so their pick-ups need approval (overtime).
- Don't put model identifiers in commits or code.
