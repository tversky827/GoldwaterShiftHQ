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
- **Notifications:** in-app, grouped (a bulk publish sends one summary per person). Email, SMS and push are wired through a provider interface and stay off until a vendor is chosen.
- **Background job** `/api/cron/marketplace` (every 10 minutes in `vercel.json`): opens scheduled listings, expires old ones, auto-publishes, escalates callouts, and delivers queued notifications.

**Tests:** 15 new marketplace tests (90 in total).

**Not done yet / notes**
- Email/SMS/push vendors: the owner needs to choose them (e.g. an email service and an SMS service). Until then only in-app notifications are sent.
- Vercel runs a cron job every 10 minutes only on paid plans; on the free plan it runs once a day.

## Next: Phase 4, Regional pool dashboard
