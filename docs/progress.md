# Progress

## Phase 1: Foundation (complete)

**Built and tested**
- Architecture and full database schema for every entity in the brief (UUID keys, timestamps, audit columns, indexes), with three migrations.
- Integrity enforced by the database itself:
  - no overlapping assignments for an employee across facilities;
  - shifts can't be overfilled, so concurrent claims for the last opening yield exactly one winner;
  - inactive or terminated employees can't be assigned;
  - employees and assignments can't be deleted (history is preserved);
  - the audit log is append-only.
- Authentication: hashed passwords, server-side sessions, invitation links tied to an existing employee record, sign-in rate limiting, and account lockout.
- Role-based access: a 38-permission catalog and 8 default roles, editable in Settings → Roles. Grants are scoped to organization, facility, department, or regional pool. Facility users see only their own employees plus employees authorized to work there.
- Facility management:
  - facilities (none hard-coded);
  - departments and units;
  - job classifications;
  - shift templates;
  - staffing budget view (read-only).
- Employee directory and profiles:
  - search and filters;
  - credentials;
  - facility authorizations;
  - regional pool classification (with a reason, audited);
  - invitations to the employee app;
  - permanent assignment history.
- Paycor integration on PostgreSQL:
  - OAuth per legal entity, with encrypted tokens and refresh;
  - retries with backoff, `Retry-After` handling, and throttling;
  - fetch-then-apply in a single transaction, idempotent;
  - deactivation handling;
  - mapping of locations, departments, and positions;
  - duplicate detection, reconciliation, and sync history;
  - manual and scheduled sync (Vercel Cron).
- Attendance on Demand timekeeping import (demonstration data, export files, and web-services connection check).
- Corporate overview for all facilities: budget vs actual hours, headcount, PRN, and pool eligibility.
- Employee mobile PWA: Home, Schedule and Profile work. Pick Up and Availability are labeled "coming".
- Audit log viewer, scoped by facility.

**Acceptance criteria covered by tests**

| # | Criterion | Test |
|---|---|---|
| 1 | An active Paycor employee appears | `tests/paycor-sync.test.ts` |
| 2 | An inactive employee can't be assigned (database level); pending claims cancelled | `tests/paycor-sync.test.ts` |
| 10 | Overlapping shifts blocked | `tests/integrity.test.ts` |
| 12 | Two employees can't take one opening | `tests/integrity.test.ts` |
| 15 | Corporate sees all facilities | `tests/access.test.ts` |
| 16 | Facility users can't access other facilities | `tests/access.test.ts` |
| 17 | History survives deactivation | `tests/paycor-sync.test.ts`, `tests/integrity.test.ts` |
| 20 | An integration outage doesn't corrupt data | `tests/paycor-sync.test.ts` |

## Next: Phase 2, Scheduling

1. Staffing budget editor: per-day matrices, effective dates, copying between facilities.
2. Shift generation from budgets, in each facility's local time.
3. Weekly calendar with drag-and-drop, coverage (e.g. 4/5), copy week / repeat / multi-week.
4. Rules engine (warning / approval required / hard block, overrides with explanation) and cross-facility hour projections.

**Decisions waiting on the owner:** A1 (pay rates) and A2 (confirm overtime and labor rule values). See `docs/architecture.md` §6.
