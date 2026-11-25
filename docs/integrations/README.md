# Integrations: Start Here

This folder explains, in plain English, how GoldwaterShiftHQ connects to:

1. **Paycor**: your HR and payroll system (employee records, employment status, jobs, locations).
2. **Attendance on Demand (AOD)**: your timekeeping system (clock punches, hours worked).

You do **not** need to be a programmer. We go one small step at a time. At each step you'll be told:
- exactly where to go and what to click,
- what you should see,
- what to tell Claude before moving on.

If your screen ever looks different from what a guide describes, stop and describe it (or share a screenshot with any secrets covered). The instructions will be adjusted to match what you actually see.

---

## The big picture (no jargon)

```
   Paycor  ──(who works here, their job, their status)──►  GoldwaterShiftHQ  ◄──(who clocked in, when, where)──  Attendance on Demand
                                                               │
                                                               ▼
                                     schedules, open shifts, overtime projections, exception reports
```

- GoldwaterShiftHQ **reads** from Paycor and AOD. It never changes punches, payroll, or employee records in those systems.
- Each piece of data has exactly one "owner" system. See [06-data-ownership-matrix.md](06-data-ownership-matrix.md).
- Until the real connections are approved, the app runs on **demonstration (fictional) data**, clearly labeled **Demonstration data** on every screen. That lets the rest of the app keep moving while vendor approvals are pending.

---

## Your checklist

Work top to bottom. You don't have to finish Paycor before starting AOD; both vendors may take days to respond, so start both requests early.

### Phase 0: Basics (about 15 minutes)
- [ ] Read the [Glossary](01-glossary.md) once (skim is fine)
- [ ] Set up secure settings: [05-secure-credentials.md](05-secure-credentials.md), Part A

### Phase 1: Paycor ([02-paycor-setup.md](02-paycor-setup.md))
- [ ] Step 1: Confirm who has Paycor admin rights
- [ ] Step 2: Get into the Paycor Developer Portal
- [ ] Step 3: Understand sandbox vs production
- [ ] Step 4: Create the app in AppCreator
- [ ] Step 5: Choose minimum permissions (scopes)
- [ ] Step 6: Register the redirect URL
- [ ] Step 7: Copy credentials into secure settings
- [ ] Step 8: Activate the app for each legal entity
- [ ] Step 9: Test the connection
- [ ] Step 10: Verify employee data is coming through

### Phase 2: Attendance on Demand ([03-aod-setup.md](03-aod-setup.md))
- [ ] Step 1: Identify your AOD account administrator and vendor/reseller
- [ ] Step 2: Send the integration request email ([04-aod-vendor-email.md](04-aod-vendor-email.md))
- [ ] Step 3: Find your AOD web address
- [ ] Step 4: Decide the integration method with AOD (web services or scheduled export)
- [ ] Step 5: Get credentials or a sample export
- [ ] Step 6: Confirm the shared employee ID
- [ ] Step 7: Test the connection
- [ ] Step 8: Verify punches match Paycor employees

### Phase 3: Verify and go live
- [ ] Confirm the ownership matrix with payroll/HR ([06](06-data-ownership-matrix.md))
- [ ] Review the reconciliation page and fix data issues at the source
- [ ] Switch from sandbox/test to production ([05](05-secure-credentials.md), Part C)

When something breaks: [07-troubleshooting.md](07-troubleshooting.md).

---

## Where things are in the app

| Page | Address (when running on your computer) | What it shows |
|---|---|---|
| Integration dashboard | http://localhost:3000/settings/integrations | Connection status, last sync, counts, errors, "Test connection" and "Sync now" buttons, mappings, sync history |
| Reconciliation | http://localhost:3000/settings/integrations?tab=reconciliation | Employee matching problems, timekeeping exceptions, scheduled vs clocked hours |

### Status colors on the dashboard
- **● Connected**: working normally.
- **▲ Needs attention**: connected before, but the last test or sync failed, or there are unresolved errors.
- **✕ Disconnected**: settings are missing or the app hasn't been authorized yet.
- **⟳ Synchronization in progress**: a sync is running right now.

---

## What we verified vs what still needs confirming

Being honest about this matters. Nothing below was invented, but some details come from public or third-party documentation and must be confirmed in your actual accounts:

| Item | Source | Status |
|---|---|---|
| Paycor uses OAuth 2.0 plus an "APIm subscription key" sent in the `Ocp-Apim-Subscription-Key` header | Paycor developer guides (developers.paycor.com, read 2026-11-25) | **Verified** |
| Access tokens last 30 minutes; refresh tokens need `offline_access` (joined to the app scope with `+`) | Paycor developer guides | **Verified** |
| Sign-in uses PKCE (`code_challenge`, method S256); the code expires in 10 minutes and works once | Paycor developer guides | **Verified**, and the app now does this |
| Tokens are issued **per legal entity**; a Paycor Company/Payroll/HR admin activates the app | Paycor developer guides | **Verified** |
| Client secrets expire every 365 days (reminder emails at 30/10/1 days) | Paycor developer guides | **Verified** |
| Token service at `/sts/v1/common` on Paycor's API host | Paycor developer guides and portal code | **Verified** (path); the full token URL `https://apis.paycor.com/sts/v1/common/token` matches third-party guides |
| Employees at `/v1/legalentities/{legalEntityId}/employees`, paged with `continuationToken` + `hasMoreResults`, at most 100 per page | Paycor developer guides | **Verified** |
| Rate limit: 1,000 calls per minute per app, counted across all APIs; 429 when exceeded | Paycor developer guides | **Verified** (the app stays at about 240/minute) |
| Don't auto-retry POSTs that return 500 (risk of double-posting); GETs are safe to retry | Paycor developer guides | **Verified**, and the app follows it |
| Sandbox and production have separate credentials; sandbox is requested via Support (about 5 business days) | Paycor developer guides | **Verified** |
| Sandbox API host `https://apis-sandbox.paycor.com` (production `https://apis.paycor.com`); sandbox activation page on `hcm-demo.paycor.com` | Paycor developer guides | **Verified** |
| Endpoint paths, field names and Data Access names for legal entity, employees, departments and pay rates | Paycor's published OpenAPI specification (v1) | **Verified**; the app now asks for status, dates, position and work location explicitly (`include=`) and reads pay rates per legal entity |
| How Goldwater uses Paycor's employee "type" (Regular, Variable, Casual…) | Depends on your Paycor setup | **Confirm**: the app treats "Casual" as PRN |
| AOD offers SOAP "web services" (CC1) using an AOD Access Account, HTTPS port 8192, company identified by web address | AOD public web-services docs | Confirm with AOD |
| Goldwater's AOD web address is `goldwater.attendanceondemand.com` (employee self-service at `/ess/`) | Reached it on 2026-11-25 | **Verified** |
| Port 8192 on that host | Connection reset from our cloud environment on 2026-11-25 | **Ask AOD** whether it's the right port and whether they allow-list IP addresses |
| Exact AOD methods for pulling punches/employees for *your* account | Not found publicly | **Ask AOD** (email template provided) |
| AOD scheduled export / SFTP availability for your account | Not confirmed | **Ask AOD** |

See also [08-notifications-setup.md](08-notifications-setup.md): turning on email and/or text-message notifications.
