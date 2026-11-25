# Operations runbook

How to run ShiftHQ safely in production: going live, security, backups, monitoring, and what to do when something breaks. Written for the owner and for whoever hosts the app. Steps marked **(IT)** are for a technical person.

---

## 1. How the app protects data (plain English)

Several independent layers, so a mistake in one is caught by another:

| Layer | What it does |
|---|---|
| **Sign-in** | Passwords stored only as strong one-way hashes (scrypt). Sign-in attempts are rate-limited per email and per network address, and accounts lock after repeated failures. Sessions and invitation links are random tokens; only their fingerprints are stored. |
| **Permissions in the app** | Every screen and action checks the person's role and scope (organization, facility, department, regional pool) on the server. |
| **The database itself** | Row-level security: the app's database login can only ever see and change rows belonging to its own organization, whatever the app code does. It can't edit or delete the audit log, can't hard-delete employees or assignments, and can't change which organization it belongs to. Integrity rules (no double-booking, no overfilled shifts, no assigning inactive staff) are enforced by the database. |
| **The browser** | Strict security headers: the app loads nothing from other sites, can't be embedded in another site, and forces HTTPS. |
| **Secrets** | Paycor tokens are encrypted at rest with `APP_ENCRYPTION_KEY`. Secrets live only in the hosting service's environment settings, never in code or chat. |
| **Audit** | Every change, override, approval, sign-in failure and report export is written to an append-only audit log. |

Known, accepted limits:
- The Content Security Policy allows inline scripts, because Next.js needs them; it still blocks every outside script source.
- Sign-in throttling by network address relies on the hosting provider's `X-Forwarded-For` header (correct on Vercel and similar). The per-email limit and account lockout don't depend on it.
- Row-level security separates organizations. Within one organization, who sees what is decided by the app's role checks (above).

---

## 2. Go-live checklist (IT)

1. **Database:** managed PostgreSQL 15+ (e.g. Neon, Supabase, AWS RDS, Azure Database for PostgreSQL) with **point-in-time recovery** turned on and at least **14 days** of retention.
2. **Create the schema** with the *owner* login:
   ```bash
   DATABASE_URL=<owner connection string> npm run db:migrate
   ```
3. **Create the organization and the first Corporate Admin** (prints a one-time invitation link):
   ```bash
   DATABASE_URL=<owner> npm run bootstrap -- --org "Goldwater Care" --email you@goldwatercare.com --name "Your Name"
   ```
4. **Create the restricted app login** (row-level security applies to it):
   ```bash
   DATABASE_URL=<owner> APP_DB_PASSWORD=<new random 32+ characters> npm run db:app-role -- --org "Goldwater Care" --role shifthq_app_goldwater
   ```
5. **Hosting environment variables** (the app's settings page at the host):
   - `DATABASE_URL`: the **restricted** login from step 4 (not the owner).
   - `APP_ENV=production`, `APP_BASE_URL=https://<your address>`.
   - `APP_ENCRYPTION_KEY`: generate once with `openssl rand -hex 32`. **Store a copy in your password manager**: without it, saved Paycor connections can't be decrypted after a restore (you'd simply reconnect Paycor).
   - `CRON_SECRET`: another random value, used by the scheduled jobs.
   - Paycor, AOD, email and text settings: see `docs/integrations/`.
   - Optional `SENTRY_DSN` for error monitoring (section 4).
6. **Check:** `npm run check-config` (shows "set"/"EMPTY", never values), then open `https://<your address>/api/health`. You should see `{"status":"ok","database":"ok",...}`.
7. Keep the **owner** login for migrations and backups only. Never give it to the running app.

Each later release: `npm run db:migrate` with the owner login, then deploy.

---

## 3. Backups and restore

**Targets:** lose at most **15 minutes** of data (RPO); be back within **4 hours** (RTO).

**Automatic (primary):** the managed database's point-in-time recovery. It can restore to any minute in the retention window.

**Independent copy (secondary, nightly) (IT):** a logical backup kept outside the database provider (e.g. an encrypted storage bucket with 30-day retention):
```bash
pg_dump -Fc --no-owner -d "<owner connection string>" -f shifthq-$(date +%F).dump
```

**Restore (IT):**
1. Create an empty database on the target server and create the shared role first (database roles aren't part of a backup):
   ```sql
   CREATE ROLE shifthq_app NOLOGIN;
   ```
2. Restore:
   ```bash
   pg_restore --no-owner -d "<owner connection to the empty database>" shifthq-YYYY-MM-DD.dump
   ```
3. Recreate the app login (step 4 of the checklist) and point `DATABASE_URL` at it.
4. Use the same `APP_ENCRYPTION_KEY` as before (otherwise reconnect Paycor).
5. Check `/api/health`, sign in, and look at Settings → Audit log to confirm the latest activity is there.

**Drill:** do a test restore into a scratch database **every quarter**. This was rehearsed on 2026-11-25: a 0.5 MB backup restored with every table, the 45 row-level-security policies, the 39 integrity triggers and the migration history intact, and the restored database still refused to delete employees.

---

## 4. Monitoring

- **Uptime:** point a monitor (e.g. UptimeRobot, Better Stack, or your host's built-in check) at `https://<your address>/api/health` every 1–5 minutes. It returns **200** when the app and database work and **503** when the database is unreachable. It shows no details.
- **Errors:** every unexpected server error is written to the host's logs as `request.unhandled_error`. People see a friendly page with a **reference code**, which matches the log entry, so they can quote it. With `SENTRY_DSN` set, errors also go to Sentry, with cookies, request bodies, emails and IP addresses removed. ShiftHQ holds staff data, not patient data.
- **Integrations:** Settings → Integrations shows each connection's status, last success and last error.
- **Background jobs** report `jobs.step_failed` in the logs if one step fails; the others still run.

---

## 5. When something goes wrong

| Situation | What happens automatically | What to do |
|---|---|---|
| **Paycor is down** or rejects the connection | The sync changes nothing, records the failure, and shows "Needs attention". Nobody is deactivated because of a partial feed. | Wait and press **Sync now** later. If it's a 401/403, reconnect Paycor (Guide 02). |
| **AOD is down** | Same: no timekeeping changes, failure recorded. Schedules and pick-ups keep working. | Retry later; contact the AOD reseller if it persists. |
| **Email or texts fail** | Each failed message is marked failed with the reason; in-app notifications are unaffected. | Check Guide 08 settings (password expired? number blocked?). |
| **The database is unreachable** | `/api/health` returns 503; people see the friendly error page. No partial writes: every change is a transaction. | Check the database provider's status page; restore (section 3) if the data is damaged. |
| **A background step crashes** | It's logged; the other steps still run, and it retries on the next run (every few minutes). | Look for `jobs.step_failed` in the logs and send the message to your developer. |
| **Someone's account may be compromised** | | Settings → Users & access → disable the user (signs them out everywhere). Review Settings → Audit log for their recent actions. |
| **A laptop with exports is lost** | Exports are recorded in the audit log (who, when, which period). | Check the audit log for `report.exported` to see what was exported. |
| **The encryption key is lost** | Saved Paycor tokens can't be decrypted. | Set a new key and reconnect Paycor for each legal entity. No other data is affected. |

---

## 6. Testing (developers)

| Command | What it checks |
|---|---|
| `npm test` | All tests on an embedded database (fast; no setup). |
| `TEST_DATABASE_URL=postgres://user@host:5432/postgres npm run test:pg` | The same tests on a real PostgreSQL server, plus row-level-security and concurrency/load tests (genuinely parallel transactions). |
| `TEST_AS_APP_ROLE=1 TEST_DATABASE_URL=... npm run test:pg` | Everything again, connected as the **restricted** app login, proving the app works under row-level security. |
| `npm run qa:mobile` (with the app running) | Every employee screen on iPhone SE, iPhone 14, Pixel 7 and iPad: no sideways overflow, tap targets ≥ 40 px, no errors; screenshots in `qa-mobile/`. |
| `npm audit --omit=dev` | Known vulnerabilities in dependencies (clean as of 2026-11-25). |

Load-test results (2026-11-25, local PostgreSQL 16): 12 people tapping "Pick up" on 3 openings at the same instant resolved correctly in 0.17 s (exactly 3 assigned). 200 simultaneous pick-ups across 40 shifts took about 1.2 s (≈170/s), with no shift overfilled and nobody double-booked. Background jobs running on five servers at once escalated a callout exactly once and sent each email exactly once.
