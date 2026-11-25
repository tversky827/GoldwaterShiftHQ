# Troubleshooting

Every error on the dashboard is written in plain English. Find it below. Still stuck? Copy the dashboard message (it never contains secrets) and share it with Claude.

## General

| Message / symptom | Meaning | Fix |
|---|---|---|
| "These settings are missing: …" | A required setting is blank | Fill it in (`.env.local` or hosting settings), restart, then `npm run check-config` |
| “That email and password don’t match” | Wrong email/password, or the account isn’t activated | Use the invitation link to set a password; ask a corporate admin for a new link if it expired |
| “Too many sign-in attempts” / “temporarily locked” | Protection against password guessing | Wait 15 minutes, then try again |
| Changes to `.env.local` have no effect | The app only reads settings at startup | Stop it (`Ctrl+C`) and run `npm run dev` again |
| "A synchronization is already in progress" | Someone clicked Sync twice | Wait a minute and refresh. A stuck sync clears itself after 30 minutes |

## Paycor

| Message | Meaning | Fix |
|---|---|---|
| "PAYCOR_ACTIVATION_URL is not set" | Activation link missing | Copy it from AppCreator into settings |
| Paycor shows a redirect/redirect_uri error page | Redirect URL doesn't match what's registered | Make the AppCreator redirect URL **exactly** match the one shown on the dashboard |
| "This authorization link expired…" | More than 15 minutes passed, or the link was reused | Click **Connect Paycor** again |
| "Paycor did not authorize the app: access_denied" | Approval was cancelled, or the user isn't a client admin | Retry as a Paycor client admin |
| "…did not return a refresh token…" | `offline_access` wasn't granted | Confirm `offline_access` is allowed for the app in AppCreator |
| 401 "did not accept the credentials" | Wrong or expired client secret, or a sandbox secret used in production | Re-copy the secret; check `PAYCOR_MODE` matches the keys; check the 365-day expiry |
| 403 "refused access" | Scope not granted, legal entity not activated, or wrong subscription key | Check scopes in AppCreator; run **Connect Paycor** for that legal entity; check the subscription key is for the right environment |
| 404 "address does not exist" | Wrong base URL or ID, or the endpoint isn't enabled for your account | Confirm the API address in the portal (`PAYCOR_API_BASE_URL`) and the legal entity ID |
| "Paycor is not connected for legal entity X" | No saved authorization for that entity | **Connect Paycor** with that legal entity ID |
| Employees imported, but names/status blank | Paycor's field names differ from what the app expects | Run **Test connection** and send Claude the "employeeFieldNames" list |

## Attendance on Demand

| Message | Meaning | Fix |
|---|---|---|
| "The address … could not be found" | Wrong `AOD_HOSTNAME` | Copy the host from your AOD login page's address bar (Step 3 of the AOD guide) |
| Connection times out | AOD requires IP allow-listing, or an old port setting | Make sure `AOD_PORT` is 443 (or blank); ask AOD whether allow-listing is needed |
| 401 | Wrong Access Account or password, or the account is on a different database | Re-check credentials with AOD; confirm test vs production database |
| "AOD punch extraction is not enabled yet…" | Expected: we're waiting for AOD to confirm the method | Use `AOD_MODE=file` with an export meanwhile |
| "no employee number/badge column found" | The export columns differ from expected | Send Claude the header row (column names only) |
| "ignored unrecognised columns: …" | Informational | If an important column is listed, tell Claude so it can be mapped |

## Reconciliation results

| Issue | What to do |
|---|---|
| In AOD but not in Paycor | Check whether the person is a new hire not yet in Paycor, or has a typo in AOD. Fix at the source. Never add them in this app. |
| Missing employee ID | Add the employee number in whichever system lacks it |
| Duplicate record | Two records share a number. Fix in the source system; matching for that number is paused until fixed. |
| Inactive employee with recent punches | Terminated in Paycor but punching in AOD. Deactivate in AOD or correct Paycor, and alert HR. |
| Facility differs | Decide which is correct (Paycor is the system of record) and fix the other |
