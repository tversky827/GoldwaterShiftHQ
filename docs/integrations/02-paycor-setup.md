# Paycor setup: step by step

> **How to use this guide:** do one step, then tell Claude what you see before moving on. Each step lists **"You should see"** and **"Tell Claude"**. If anything differs, describe it or share a screenshot with secrets covered. Paycor's screens change over time, and this guide will be adjusted to what's actually on your screen.
>
> **Never paste a client secret, subscription key, password, or token into chat.** When it's time to store one, Step 7 shows where it goes.

---

## Step 1: Confirm who has Paycor admin rights

**Why:** Paycor only lets a **client administrator** approve ("activate") an outside app for your company's data. You also need someone who can register for the developer portal.

**Do this:**
1. Log in to Paycor as you normally do.
2. Find out whether your user is a **Client Administrator** (sometimes shown as "Admin" or "Super User"). If unsure, ask whoever manages Paycor at your company, or your **Paycor Client Success / account representative**.
3. Write down (on paper or in a password manager, not in chat):
   - your Paycor **Client ID / Company ID** number(s)
   - the names of each **legal entity** (each company/EIN) whose employees should be in the scheduling platform.

**Tell Claude:** "I am / am not a Paycor client admin" and "We have __ legal entities." Names are fine; you don't need to share ID numbers in chat.

---

## Step 2: Get into the Paycor Developer Portal

**Website:** https://developers.paycor.com/

**Do this:**
1. Open https://developers.paycor.com/ in your browser.
2. Look for **Sign in**, **Sign up**, or **Join the Developer Portal**.
3. Register using your **work email**.
4. Paycor reviews portal registrations, so access is **not instant**. If asked why you need access, say:

   > "We are a Paycor client building an internal workforce scheduling application for our skilled nursing facilities. It needs **read-only** access to employee demographic, employment status, job/position, and work location data for our own legal entities. We do not resell the integration."

5. If you can't find a sign-up option, or approval takes more than a few business days, contact your **Paycor account representative** and ask: *"How do we, as a Paycor client, get developer portal and API access to build an internal integration for our own company?"* Paycor may route you to a partner or integrations team.

**You should see:** after approval, a portal home page with menus such as **Guides**, **Explore** (the API reference), and an app-management area (Paycor calls it **AppCreator**).

**Tell Claude:** which of those menus you see, or the exact message if access is pending or denied.

---

## Step 3: Understand sandbox vs production

- **Sandbox** = Paycor's practice environment with fake employees. Paycor's sandbox terms say only simulated/test data may be used there. Do all first testing here.
- **Production** = your real Paycor company data.

Paycor's developer guide (read 2026-11-25) says the two environments have **separate sign-in credentials and use different tokens and IDs**. The same APIs exist in both; only the data differs. A **sandbox account is not automatic**: you request one from the portal's **Support** form (category **Sandbox Environment**), and Paycor's stated turnaround is **about 5 business days**. The guide shows the sandbox web address as a picture we couldn't read, so we'll still confirm it from what your portal shows.

**Do this (if you have no sandbox yet):** once signed in to the portal, open **Support**, choose the category **Sandbox Environment**, and ask for a Developer Portal sandbox account for your company.

**Do this:** in the portal, look for anything labeled **Sandbox**, **Test**, **Production**, or **Environment**, especially on your subscription/keys page.

**Tell Claude:** whether you see separate sandbox and production keys, and any web address shown next to them (addresses aren't secret, so you can share those).

The app keeps them apart with the setting `PAYCOR_MODE` (`sandbox` or `production`), and the dashboard shows a red **PRODUCTION - REAL DATA** label whenever real data is in use.

---

## Step 4: Create the app in AppCreator

1. In the portal, open **AppCreator** (it may be under "My Apps", "Applications", or your profile menu).
2. Click to **create a new application**.
3. Fill in:
   - **Name:** `GoldwaterShiftHQ`
   - **Description:** "Internal workforce scheduling platform for our SNF facilities. Read-only sync of employee, status, job, and location data."
   - **Type** (if asked): an internal or customer app, *not* a marketplace/partner app. If unsure, stop and tell Claude what choices are offered.
4. Save.

**You should see:** the app's detail page, likely with tabs such as **General**, **Data Access / Scopes**, **Credentials / Secrets**, and **Redirect URIs**.

**Tell Claude:** the names of the tabs you see. Don't copy any secrets yet.

---

## Step 5: Choose minimum permissions (scopes)

**Rule: ask only for what's needed, and read-only.** We don't need any "write", "create", "update", or "delete" permissions.

Paycor's exact permission names will be shown in your portal. We'll map them together. **What we need:**

| Need | Why | Priority |
|---|---|---|
| Legal entity / company information (read) | Know which company each employee belongs to | Required |
| Employee identity / demographics: name, employee number (read) | Identity and matching to AOD | Required |
| Employment status, hire and termination dates (read) | Who is active, terminated, or on leave | Required |
| Position / job title, department (read) | Job classification for scheduling | Required |
| Work location (read) | Home facility | Required |
| Payroll hours / earnings (read) | Later: comparing payroll hours to scheduled and clocked hours | Optional, request later |
| Anything with "write", "update", "payroll submit", banking, SSN, tax | **Not needed. Don't request.** | ✗ |

Also look on the **General** tab for the app's **scope name**. We'll store it as `PAYCOR_APP_SCOPE`. The app automatically adds `offline_access`, which lets Paycor issue a refresh token.

**Tell Claude:** the list of permission/scope names the portal offers (names only). Claude will tell you exactly which boxes to tick.

---

## Step 6: Register the redirect URL

**What it is:** after a Paycor admin clicks "Allow", Paycor sends the browser back to this address. It must match **exactly**, including `https`, slashes, and capitalization.

Our app's redirect URL is:

| Where the app runs | Redirect URL |
|---|---|
| Your own computer (testing) | `http://localhost:3000/api/integrations/paycor/callback` |
| Hosted (later) | `https://YOUR-APP-ADDRESS/api/integrations/paycor/callback` |

The integration dashboard always displays the correct one under the **Connect Paycor** button, and `npm run check-config` prints it too.

**Do this:** in AppCreator, open the app's **Security Connections** tab and add the URL as an **Approved Return OAuth URL**, then save. (Paycor's guide says the address can't contain anything after a `?`; ours doesn't.)

**Note:** some vendors reject `http://localhost`. If Paycor does, tell Claude, and we'll use the hosted address instead.

**Tell Claude:** "Redirect URL saved," or the error text if it was rejected.

---

## Step 7: Copy credentials into secure settings (not chat)

From the portal you'll collect:

| Portal label (approximate) | Setting name | Secret? |
|---|---|---|
| Client ID | `PAYCOR_CLIENT_ID` | No |
| Client Secret | `PAYCOR_CLIENT_SECRET` | **YES** |
| Subscription key (primary key) | `PAYCOR_SUBSCRIPTION_KEY` | **YES** |
| Scope name (General tab) | `PAYCOR_APP_SCOPE` | No |
| Activation / authorization URL | `PAYCOR_ACTIVATION_URL` | No |

Follow [05-secure-credentials.md](05-secure-credentials.md), Part B, to put them in `.env.local` (your computer) or the hosting service's environment variables. Then set `PAYCOR_MODE=sandbox`.

**Important:**
- The client secret may be shown **only once**. Copy it straight into `.env.local` or your password manager.
- Paycor client secrets **expire after 365 days**. Put a calendar reminder 11 months from today: "Renew Paycor client secret."

**Check:** run `npm run check-config`. It reports "set" or "EMPTY" for each value **without displaying the values**.

**Tell Claude:** paste the output of `npm run check-config` (it contains no secrets).

---

## Step 8: Activate the app for each legal entity (OAuth)

**What happens (plain English):** you prove to Paycor that you, an admin, approve this app reading your company's data. Paycor gives our app a pass for that one legal entity. Repeat once per legal entity.

1. Start the app (`npm run dev`) and sign in as a corporate administrator, and open **Settings → Integrations** (http://localhost:3000/settings/integrations).
2. On the **Paycor** card, type the **Legal Entity ID** and click **Connect Paycor**.
3. Your browser goes to Paycor. Log in with a Paycor Perform account that has the **Company, Payroll or HR admin** role, and approve the app. (If Paycor shows **Error 403**, that account lacks the role; ask your internal Paycor admin.) Paycor lets you tick several legal entities at once **if they belong to the same company**. The app currently connects one at a time, which always works.
4. **Finish within 10 minutes.** Paycor's one-time code expires after 10 minutes and can only be used once. If it fails, just click **Connect Paycor** again.
5. Paycor sends you back to the dashboard.

**You should see:** a green message: *"Paycor authorized for legal entity ____. Next: click 'Test connection'."*

**If you see a red message instead:** copy the message (it never contains secrets) and tell Claude. Common causes are in [07-troubleshooting.md](07-troubleshooting.md#paycor).

Then add every legal entity ID you want synced to `PAYCOR_LEGAL_ENTITY_IDS` (comma-separated).

---

## Step 9: Test the connection

On the dashboard, click **Test connection** on the Paycor card.

**You should see:** *"Success! Paycor answered for legal entity ___ and returned employee data."* plus **Details**, which lists the **names** of the fields Paycor returned (for example `firstName`, `employeeNumber`). Only field *names* are shown, never anyone's actual data.

**Tell Claude:** paste the Details line. Claude uses the field names to confirm or adjust how the app reads Paycor's data.

---

## Step 10: Verify employee data is coming through

1. Click **Sync now** on the Paycor card.
2. Check the **Employees imported (Paycor)** number. Does it roughly match your headcount for that legal entity? (In sandbox, it will be Paycor's fake employees.)
3. Spot-check a few people you know:
   - [ ] **Status**: a terminated employee shows as terminated; someone on leave shows as on leave.
   - [ ] **Job / department** looks right.
   - [ ] **Home facility** (work location) is right.
   - [ ] **Employee number** matches what's in AOD. This is the key for matching.
4. Open **Reconciliation & exceptions** and look for "Missing employee ID (Paycor)" or "Duplicate record (Paycor)".

**Tell Claude:** what matched and what didn't. Don't paste employee names or IDs into chat; just say "status looked right for 5 of 5" or similar.

---

## Later: payroll and timekeeping endpoints

After the basics work, we'll look in the portal's **Explore** section for payroll-hours or earnings endpoints and confirm whether they're enabled for your account. The app shows "Payroll (Paycor): not yet available" until then. Not every Paycor endpoint is enabled for every customer, so we'll check rather than assume.

## Later: pay rates (approved)

You approved importing pay rates. The app stores only the **current base hourly rate** (salaried pay is converted to an hourly equivalent). Only Corporate Admins can see it by default.

To turn it on with real data:
1. In the portal's **Explore** section, look for an employee **pay rates** endpoint and the permission (scope) it needs. Tell Claude the names you see.
2. Add that permission to the app in AppCreator, then reconnect each legal entity, since new permissions require re-approval.
3. Set `PAYCOR_IMPORT_PAY_RATES=true` in secure settings.
4. Run **Sync now**. The employee profile will show a **Compensation** card for Corporate Admins.
