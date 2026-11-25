# Keeping credentials safe

## The rules (non-negotiable)

1. **Never put a secret in source code.** The code reads secrets from *environment variables* only.
2. **Never commit secrets to GitHub.** The file `.env.local` is already excluded by `.gitignore`.
3. **Never paste secrets into chat, email, tickets, or shared documents**, including chats with Claude. Claude will never ask for a secret's value. To check whether settings are filled in, run `npm run check-config`. It shows only "set" or "EMPTY".
4. **Keep sandbox/test and production separate**, with different values and an explicit mode setting.
5. **If a secret is ever exposed** (pasted somewhere, emailed, committed), treat it as stolen: regenerate it in the vendor portal right away, then update your settings.

**Which values are secret?**

| Setting | Secret? |
|---|---|
| `PAYCOR_CLIENT_SECRET`, `PAYCOR_SUBSCRIPTION_KEY` | **Yes** |
| `AOD_ACCESS_PASSWORD` | **Yes** |
| `AOD_ACCESS_ACCOUNT` | Treat as secret |
| `ADMIN_PASSWORD`, `APP_ENCRYPTION_KEY` | **Yes** |
| `PAYCOR_CLIENT_ID`, `PAYCOR_APP_SCOPE`, `PAYCOR_ACTIVATION_URL`, `AOD_HOSTNAME`, modes | No |

---

## Part A: On your own computer (`.env.local`)

1. In the project folder, make a copy of `.env.example` and name the copy `.env.local`.
   - **Mac/Linux terminal:**
     ```bash
     cp .env.example .env.local
     ```
   - **Windows:** in File Explorer, copy and paste `.env.example`, then rename the copy to `.env.local`. (Turn on "File name extensions" under the View menu so you can see the full name.)
2. Open `.env.local` in a plain text editor (Notepad, TextEdit in plain-text mode, or VS Code).
3. Set a strong `ADMIN_PASSWORD`.
4. Generate an encryption key by running this in the terminal:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Copy the output into `APP_ENCRYPTION_KEY=`. It encrypts the Paycor tokens the app saves. **Don't change it later**, or saved Paycor connections must be redone.
5. Leave `PAYCOR_MODE=mock` and `AOD_MODE=mock` for now.
6. Save. Then check your work:
   ```bash
   npm run check-config
   ```

Format: one setting per line, `NAME=value`, with no spaces around `=` and no quotes needed.

---

## Part B: Adding vendor credentials

When a guide says "put it in secure settings":

- **Testing on your computer:** open `.env.local`, paste the value after the `=`, and save. Restart the app (`Ctrl+C`, then `npm run dev`) so it picks up the change.
- **Hosted app:** use the hosting service's secret settings screen (Part D). Never edit code.

Copy secrets **directly from the vendor portal into the settings file or screen**. Don't route them through chat, email, or a notes app. A password manager is fine for keeping a backup.

---

## Part C: Sandbox/test vs production

| | Testing | Live |
|---|---|---|
| Paycor | `PAYCOR_MODE=sandbox` + **sandbox** subscription key and secret | `PAYCOR_MODE=production` + **production** key and secret |
| AOD | `AOD_ENVIRONMENT=test` + test-database Access Account | `AOD_ENVIRONMENT=production` + production Access Account |

Safety features already built in:
- The dashboard always shows the mode. Production shows a red **PRODUCTION - REAL DATA** label, and mock shows a yellow **MOCK DATA - NOT REAL** label.
- Saved Paycor tokens are tagged sandbox or production, so a sandbox token is never used against production.
- Switching between mock and real data removes the other kind, so fake and real employees never mix.

**Recommended:** keep **two separate hosted environments**, for example Vercel "Preview" with sandbox values and Vercel "Production" with production values, so nobody has to edit values back and forth.

---

## Part D: Hosted app (for example Vercel)

1. Open your project in the hosting dashboard → **Settings** → **Environment Variables**.
2. For each setting in `.env.example`, click **Add**, enter the **Name** exactly (for example `PAYCOR_CLIENT_SECRET`), paste the **Value**, and choose which environment it applies to (Production / Preview).
3. Mark secret values as **Sensitive** if the option exists.
4. Redeploy so the app picks up the new values.
5. Set `APP_BASE_URL` to the hosted address, and register the hosted redirect URL in Paycor (see the Paycor guide, Step 6).

> ⚠️ **Before hosting with real data:** the integration currently saves its data to a local file (`/data`). Hosting services like Vercel don't keep local files, so a real database must be connected first. This is a planned engineering step; tell Claude when you're ready to host.

---

## Part E: Maintenance reminders

- 🔁 **Paycor client secret expires every 365 days.** Set a calendar reminder for 11 months after creating it.
- 🔁 Change `ADMIN_PASSWORD` whenever someone with access leaves.
- 🔁 Review who has Paycor client-admin and AOD Access Account rights once a year.
