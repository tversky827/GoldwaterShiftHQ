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

## Next: Phase 3, Marketplace

Publish open shifts (single, bulk, scheduled, automatic, expiring), the employee Pick Up tab with one-tap claims (using the same rules engine and atomic assignment), approval workflows for claims, waitlists, swaps, callouts with escalation, and notifications (in-app, email, SMS, push).
