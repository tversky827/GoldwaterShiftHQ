# ShiftHQ: SNF Workforce Management & Scheduling

One platform for corporate leadership and each skilled nursing facility: employees imported from Paycor, staffing budgets, schedules, an open-shift marketplace, a regional staffing pool, and an employee mobile app.

- **Architecture, schema, navigation, roadmap:** [docs/architecture.md](docs/architecture.md)
- **Connecting Paycor & Attendance on Demand (plain-English guides):** [docs/integrations/README.md](docs/integrations/README.md)
- **Progress by phase:** [docs/progress.md](docs/progress.md)

## Run it on your computer

Requires Node.js 20+ (https://nodejs.org, "LTS"). No database install is needed: a built-in PostgreSQL engine is used automatically.

```bash
npm install
cp .env.example .env.local
npm run seed:demo
npm run dev
```

Open http://localhost:3000. The sign-in page lists the demonstration accounts (one per role). All demonstration data is fictional and labeled as such.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run locally |
| `npm test` | Automated tests (run against a real PostgreSQL engine) |
| `npm run build` | Production build |
| `npm run seed:demo` | Load the demonstration organization (refused when `APP_ENV=production`) |
| `npm run bootstrap -- --org "Name" --email you@company.com --name "Your Name"` | Production: create the organization and first Corporate Admin invitation |
| `npm run db:migrate` | Apply database migrations (production deploys) |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run check-config` | Show which settings are filled in (never prints secret values) |

## Code map

| Path | What it is |
|---|---|
| `src/db/schema.ts`, `drizzle/` | Database schema and migrations (incl. hand-written integrity constraints) |
| `src/server/` | All business logic, server-only: auth, RBAC, facilities, employees, users, audit |
| `src/server/integrations/` | Paycor (OAuth, client, sync) and Attendance on Demand (SOAP, export files, sync) |
| `src/app/(staff)/` | Staff experience (desktop-first) |
| `src/app/(employee)/app/` | Employee experience (mobile-first PWA) |
| `src/components/ui/` | Design system components |
| `tests/` | Integration tests mapped to the acceptance criteria |

## Operations

Going live, backups, monitoring and incident playbooks: [docs/operations.md](docs/operations.md).
