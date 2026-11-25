# Progress

## Phase 1: Foundation (complete)

- Full PostgreSQL schema with integrity enforced by the database itself:
  - no overlapping shifts for one employee;
  - no overfilled shifts;
  - no assigning inactive employees;
  - no hard deletes;
  - an append-only audit log.
- Sign-in, invitations, sessions, rate limiting, and role-based access scoped by organization, facility, department, or pool.
- Facilities, departments, units, classifications, shift templates, the employee directory and profiles, users and roles, and the audit viewer.
- Paycor and Attendance on Demand integrations: OAuth per legal entity, transactional and idempotent sync, mappings, reconciliation, and history.
- Corporate overview and the employee PWA shell.

## Phase 2: Scheduling (complete)

**Built and tested**
- **Staffing budget editor:**
  - per-day matrix by shift and position, with effective dates and active/inactive status;
  - "Fill" to copy a row across the week;
  - copy to another facility (starts inactive for review; shifts matched by code).
- **Schedule generation:**
  - turns the active budget into shifts with N openings, in each facility's local time, correct across daylight saving;
  - safe to re-run ("Sync with budget");
  - can create several weeks at once.
- **Weekly scheduler:**
  - coverage shown as filled/required (e.g. 4/5) in color;
  - open slots shown explicitly;
  - drag-and-drop or tap-to-assign from a staff panel with search, position filter, qualifications, cross-facility/pool flags, credential alerts, days off, and projected weekly hours across all facilities;
  - remove assignments, add or remove openings, add shifts outside the budget;
  - copy last week, repeat for N weeks, publish (notifies employees in the app);
  - pending approvals queue.
- **Rules engine**, evaluated before every assignment, with three outcomes (warning / approval required / block):
  - overlap, facility authorization, position qualification, credentials;
  - minimum rest, daily hours, weekly hours, consecutive days;
  - employment-type hour guidelines, availability, weekly overtime.
- **Overrides and approvals:** blocks that allow overrides need `rules.override` plus an explanation. Approval-required items go to an approver, or are approved inline by one with an explanation. Every override is recorded in `rule_overrides` and the audit log.
- **Hours across all facilities**, kept separate: actual, approved, scheduled, and projected (actual hours for past days, scheduled hours for upcoming ones).
- **Settings → Rules:** edit values and outcomes at organization level, customize per facility, and confirm (A2). The overlap rule can't be weakened.
- **Employee availability:** days off, preferred shifts and facilities, and maximum weekly hours. These feed the rules engine and the staff panel.
- **Pay rates (A1, approved):** imported into a restricted table and shown only to Corporate Admins. Live import is switched on once the Paycor endpoint is confirmed.

**Acceptance criteria now covered by tests:** 3, 4, 5, 9, 10, and 18, in addition to Phase 1's 1, 2, 12, 15, 16, 17, and 20. 73 tests in total.

## Phase 3: Marketplace (complete, except external notification vendors)

**Built and tested**
- **Publishing open shifts** (Open shifts page, "Publish open shifts"):
  - single or bulk (pick from every unfilled shift in the next 14 days, filter by position, select all);
  - publish now or **schedule** for a later date and time (the background job opens it);
  - **closing time** (default 2 hours before the shift; configurable);
  - **audience**: the facility's own staff, or also staff authorized there (including the regional pool);
  - optional **incentive** note and "review every pick-up";
  - **automatic publishing** of unfilled shifts on published schedules, N hours ahead (Settings → Marketplace, per facility or organization-wide). A withdrawn listing is never re-posted automatically;
  - **withdraw** (anyone who asked for it is cancelled and told why).
- **Employee Pick Up tab:** only shifts the employee is qualified for (position) and allowed to work (home facility or authorization). Every card is checked with the **same rules engine** as a scheduler assignment: illegal shifts (e.g. overlapping) are hidden, warnings are shown, and anything needing approval says why. One tap assigns instantly when the rules allow, atomically through the database's capacity lock.
- **Claim approvals:** pending claims go to reviewers (`claims.review`). Rules are re-checked at decision time; approving an "approval required" rule (e.g. overtime) also needs `assignments.approve`, overriding a block needs `rules.override`, and both need a written explanation, recorded in `rule_overrides` and the audit log. Declines can include a note to the employee.
- **Waitlists:** when a shift fills, employees can join its waitlist. When an opening is freed (removal, callout), the listing reopens and waitlisted employees are offered it.
- **Shift swaps:** the employee picks a colleague's shift (same facility and position, next 14 days; colleagues shown as first name + last initial), the colleague accepts, a manager (`swaps.approve`) approves, and both assignments change in one transaction after re-checking every rule for both people.
- **Callouts:** "I can't make it" in the employee app, or "Record callout" for managers. The shift is posted immediately (urgent) to the facility's qualified staff and managers are notified. If nobody picks it up, it **escalates**: after 30 minutes to authorized staff from other facilities and the pool, then after 60 more to leadership. Times are configurable. Covered or uncovered status is tracked.
- **Notifications:** in-app, grouped (a bulk publish sends one summary per person). **Email** (your own mailbox over SMTP, e.g. Microsoft 365, or SendGrid) and **text messages** (Twilio) can be switched on separately; see Guide 08. Texts are only for urgent updates and only to people who added a number and agreed. Everyone manages their own choices (Profile → Notifications / Settings → My notifications).
- **Background work** (opening scheduled listings, closing old ones, auto-publishing, escalating callouts, sending email/texts) runs automatically while people use the app, at most every 2 minutes, and also through `/api/cron/marketplace` when the hosting service provides a scheduler. Nothing needs to be set up for it.

**Tests:** 15 marketplace tests, 8 notification tests, and Paycor mapping tests against the published API specification (101 in total).

**Not done yet / notes**
- Email/text vendor accounts are not created yet (Guide 08 walks through it). Phone push notifications are not built.

## Phase 4: Regional pool (complete)

**Built and tested**
- **Regional pool page** (`/pool`, "Regional pool" in the sidebar) for the pool manager and corporate (every facility) and for regional directors and facility leaders with pool access (their own facilities only).
  - **Where help is needed:** unfilled shifts in the next 7 days for positions the pool covers, with how many pool staff are qualified *and* authorized for each, and whether the shift is already posted.
  - **Find pool staff:** for any shift, every eligible pool member checked against the full rules engine and ranked (good fit → note → needs approval → not allowed, then fewest hours). One click places them. Exceptions follow the normal rules (approval or override with an explanation, or a pending approval for the facility). The employee and the facility's schedulers are notified (the employee by text too, if they opted in).
  - **Pool staff:** one row per person (never duplicated per facility): authorized facilities, hours this week **across every facility** (clocked and scheduled, against the overtime threshold or their personal limit), hours left, next shift, and credential alerts. This week / next week.
  - **Add to pool:** pick an employee, tick the facilities they may work at, give a reason: one step, fully audited.
- **Permissions:** a pool manager can place *regional pool* employees at any facility and manage their facility authorizations (fixed: this was previously refused), but can't place non-pool staff. Schedulers keep placing anyone at their own facility.

**Tests:** 6 new pool tests (107 in total).

## Phase 5: Reporting and exports (complete)

**Built and tested**
- **Reports page** (`/reports`, for anyone with `reports.view`, scoped to their facilities):
  - periods: this week, last week, last 4 weeks, last 3 months, or custom dates; one facility or all;
  - headline figures: **fill rate**, **scheduled vs budget**, **clocked vs scheduled**, **overtime (estimate)**, **median time to fill** open shifts, **callouts covered** (and median time to cover);
  - **Hours by facility** chart (budget / scheduled / clocked) with hover details, plus the same figures in a table with pool hours, time to fill and callouts;
  - **Overtime** list: people over the threshold in a workweek, counting every facility.
- **Definitions are explicit** (on the page and in the export's "About" sheet). Ratios compare only facilities that have a schedule for the period, so an unscheduled facility shows "No schedule" rather than 0%. Overtime is an estimate; payroll stays the official record.
- **Exports** (`reports.export`): an **Excel workbook** with Summary, Coverage (every shift), Overtime, Open shifts, Callouts and About sheets, or a **CSV** of any one of them. Exports are limited to the facilities you're responsible for, protected against spreadsheet formula injection, and **recorded in the audit log**.
- **Overview → "This week"** strip: openings filled, scheduled vs budget, projected overtime, callouts covered, linking to Reports.

**Tests:** 8 new report tests (115 in total).

## Phase 6: Hardening (complete)

**Built and tested**
- **Row-level security** (migration 0008): PostgreSQL itself keeps each organization's data separate. The app connects as a restricted login (`npm run db:app-role`) that can only see its own organization, can't change which organization that is, can't edit or delete the audit log, and can't hard-delete employees, assignments or organizations. A login with no organization sees nothing.
- **Real-PostgreSQL testing:** the whole suite runs on a real server (`npm run test:pg`), and again as the restricted login (`TEST_AS_APP_ROLE=1`): 129 tests pass both ways.
- **Load tests:** simultaneous pick-ups, double-booking attempts, bursts of 200 claims, background jobs on five servers at once. **They found and we fixed a real bug:** under truly parallel delivery, an email could be sent more than once. Each message is now sent exactly once.
- **Security review:** sign-in, sessions, invitations, redirects, permissions and exports reviewed. Added a strict Content Security Policy and other headers, no caching of API responses, and friendly error pages with reference codes. Upgraded or patched dependencies until `npm audit` was clean.
- **Monitoring:** `/api/health` for uptime checks; structured error logging; optional Sentry with personal data removed.
- **Failure drills:** timekeeping outage mid-sync, database outage, and a crashing background step (now isolated, so the other steps still run).
- **Mobile QA:** `npm run qa:mobile` checks every employee screen on four devices. Fixed five tap targets that were too small.
- **Backup and restore:** runbook plus a real drill (backup → restore → verified counts, policies, triggers and protections).
- **Operations runbook:** `docs/operations.md` (go-live checklist, backups, monitoring, what to do when something breaks).

**Tests:** 129 on real PostgreSQL, also as the restricted login (118 on the embedded database, where the 11 real-server-only tests are skipped).

## What's next
All six phases are complete. Remaining work depends on vendor access and owner decisions: connecting Paycor (sandbox first) and AOD, confirming the overtime/labor rules (Settings → Rules), choosing email/text providers, and choosing hosting (then following `docs/operations.md`).
