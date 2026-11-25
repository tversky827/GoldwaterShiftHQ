# Attendance on Demand (AOD) setup: step by step

> Same rules as the Paycor guide: one step at a time, tell Claude what you see, and **never paste passwords into chat**.

## What we know (and don't know) about AOD

**Publicly documented by AOD** (their web-services site, `attendanceondemand.com/webservices`):
- AOD has **Web Services** ("Client Contract 1", CC1) using SOAP, an older XML-based API style.
- Calls require an AOD **Access Account** (a login meant for software) using a username and password.
- HTTPS only, on **port 8192**.
- Your company is identified by its **AOD web address** (the part before `.attendanceondemand.com`, or a similar host).
- AOD recommends testing against a **development/test database**.
- Documentation sections exist for Employees, Time & Labor (punches, hours for payroll), Scheduling, and more.

**NOT confirmed, so we must ask AOD:**
- Whether web-services access is included in or available for **your** subscription.
- The exact functions to pull punches, hours, and employee lists for your account.
- Whether AOD can send a **scheduled export** (for example nightly CSV, by SFTP or email) instead.
- Whether a test database exists for your account.
- Whether AOD already sends hours to Paycor payroll. Many companies already run an AOD→Paycor payroll export, and that affects who "owns" approved hours.

**Contact:** Attendance on Demand, Inc., **1-800-465-9980** (from AOD's published job aids). Many companies buy AOD through a **reseller (channel partner)**, in which case the reseller usually handles integration requests. Step 1 sorts this out.

The app already supports three modes, so we're ready whichever path AOD offers:

| `AOD_MODE` | Meaning |
|---|---|
| `mock` | Fake punches for testing (current) |
| `file` | Read AOD scheduled-export CSV files (upload on the dashboard, or drop in a folder) |
| `soap` | Talk to AOD Web Services directly |

---

## Step 1: Identify your AOD administrator and vendor

1. Who at your company administers AOD (adds employees, fixes punches, runs payroll export)? Usually payroll or HR.
2. Find out **who you buy AOD from**. Look at the AOD invoice or contract:
   - billed by **Attendance on Demand, Inc.** → contact AOD directly;
   - billed by another company (a payroll or timeclock dealer) → that **reseller** is your first contact.
3. Ask the AOD admin: **"Do we currently export hours from AOD into Paycor for payroll? How?"**

**Tell Claude:** (a) who the AOD admin is (role is fine), (b) AOD direct or a reseller, (c) whether hours already go to Paycor, and how.

---

## Step 2: Send the integration request

Use the ready-made email in [04-aod-vendor-email.md](04-aod-vendor-email.md). Fill in the bracketed parts and send it to your AOD support contact or reseller, CC'ing your AOD admin.

**Tell Claude:** when it's sent. When they reply, share the reply text (remove any passwords first). Claude will read it and tell you the next step.

---

## Step 3: Find your AOD web address

1. Go to the page where you normally log in to AOD.
2. Look at the browser's address bar. It will look something like `https://SOMETHING.attendanceondemand.com/...`.
3. The part **between `https://` and the next `/`** is your **AOD host name**, for example `yourcompany.attendanceondemand.com`.

The host name isn't secret, so you can share it with Claude. It goes in the setting `AOD_HOSTNAME`.

**Tell Claude:** the host name.

---

## Step 4: Decide the integration method (with AOD's answer)

| If AOD says... | We do... |
|---|---|
| "Yes, web services are available, and here is an Access Account" | Step 5A |
| "We can schedule a nightly export (CSV) by SFTP/email" | Step 5B |
| "Web services cost extra / aren't available" | Step 5B (export) while you decide |
| Something else | Share the reply with Claude |

---

## Step 5A: Web services credentials

1. AOD (or the reseller) creates an **Access Account** for the integration. It should be:
   - a **dedicated** account, not a real person's login;
   - **read-only** where AOD allows it;
   - on the **test database** first, if one exists.
2. Put the details into secure settings (never in chat). See [05-secure-credentials.md](05-secure-credentials.md):
   - `AOD_MODE=soap`
   - `AOD_ENVIRONMENT=test` (until we go live)
   - `AOD_HOSTNAME=...`
   - `AOD_ACCESS_ACCOUNT=...` (secret-ish)
   - `AOD_ACCESS_PASSWORD=...` (**secret**)
3. Ask AOD for the **documentation of the methods** to: list employees (with employee number and badge), and extract punches/worked segments for a date range. The email template already asks for this.

## Step 5B: Scheduled export

1. Ask AOD (or your AOD admin) to set up an export containing **one row per punch pair / worked segment** with these columns:
   `Employee Number, First Name, Last Name, Facility (or Location/Workgroup), Date, In, Out, Hours, Approved`
2. Also ask for an **employee list export**: `Employee Number, Badge Number, First Name, Last Name, Home Facility, Status`.
3. Ask for a **sample file using test or fake data** first, so we can confirm the format without sharing real employee data.
4. Set `AOD_MODE=file`. On the dashboard, the AOD card will show an **Upload** button.

---

## Step 6: Confirm the shared employee ID

Matching only works if **the same person has the same number** in Paycor and AOD.

1. Ask your AOD admin: "Which AOD field holds the Paycor employee number? Employee ID/Number, badge, or something else?"
2. Pick 3 employees and compare (on screen, not in chat): the Paycor **employee number** vs the AOD **employee number** and **badge**.
3. If they match on employee number → `EMPLOYEE_MATCH_FIELD=employeeNumber` (default). If they only match on badge → `badgeNumber`. If neither matches, tell Claude; a mapping table may be needed.

**Tell Claude:** "Employee numbers match in 3 of 3" (or what differed, without sharing the actual numbers).

---

## Step 7: Test the connection

On the dashboard, click **Test connection** on the AOD card.

- **Web services mode:** success means the app reached your AOD address and read its list of available functions. The Details list the functions related to punches/employees. Share that list with Claude; it's not secret. Data pulls are switched on once AOD confirms which functions to use.
- **File mode:** success says how many employees and rows were read, and lists any columns that weren't recognized.

---

## Step 8: Verify punches match Paycor employees

1. Click **Sync now** on the AOD card.
2. Open **Reconciliation & exceptions**.
3. Review:
   - **In AOD but not in Paycor**: people punching who Paycor doesn't know. The app **never** creates them automatically. Fix in Paycor or AOD.
   - **Missing employee ID**: fix in whichever system lacks it.
   - **Duplicate record**: two people share a number. Fix at the source.
   - **Inactive employee with recent punches**: terminated in Paycor but still punching. Investigate.
   - **Facility differs between systems**: Paycor and AOD disagree on home facility.
4. Compare a few employees' **Clocked** hours to what AOD shows on their timecard.

**Tell Claude:** the counts in each category (no names needed).
