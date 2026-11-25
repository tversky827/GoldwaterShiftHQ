# GoldwaterShiftHQ

Workforce scheduling platform for skilled nursing facilities ("SNF Workforce"), integrating with:

- **Paycor**: HR, employee records, employment status (system of record for employees)
- **Attendance on Demand**: timekeeping and clock punches (system of record for punches)

## Start here

**Setting up the integrations?** Open [docs/integrations/README.md](docs/integrations/README.md). It's a plain-English, step-by-step guide written for non-developers.

## Run it on your computer

Requires Node.js 20+ (https://nodejs.org, "LTS" version).

```bash
npm install
cp .env.example .env.local     # then edit .env.local (see docs/integrations/05-secure-credentials.md)
npm run dev
```

Open http://localhost:3000/admin/integrations. With the default `mock` settings, the app runs on clearly labeled fake data, so no vendor accounts are needed.

| Command | Purpose |
|---|---|
| `npm run dev` | Run locally |
| `npm test` | Run automated tests |
| `npm run check-config` | Show which settings are filled in (never prints secret values) |

## Code map

| Path | What it is |
|---|---|
| `src/lib/config.ts` | Reads settings from environment variables (no secrets in code) |
| `src/lib/ownership.ts` | Data ownership matrix and write guard |
| `src/lib/integrations/paycor/` | Paycor OAuth, API client, mock data |
| `src/lib/integrations/aod/` | AOD web services (SOAP), export-file importer, mock data |
| `src/lib/integrations/sync.ts` | Sync engine and dashboard status |
| `src/lib/reconciliation/` | Employee matching and timekeeping exceptions |
| `src/app/admin/integrations/` | Integration dashboard and reconciliation pages |
| `src/lib/store/db.ts` | Temporary JSON-file storage (replace with a real database before hosting) |
