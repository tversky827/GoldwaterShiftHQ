# Guide 08: Email and text-message notifications

ShiftHQ always shows notifications **inside the app**. You can also turn on **email**, **text messages**, or **both**. Each is optional, and you can add one now and the other later.

| | What it's used for | What you need |
|---|---|---|
| **Email** | Everything: new open shifts, decisions, swaps, callouts | **Option A:** a mailbox you already have (for example Microsoft 365), or **Option B:** a SendGrid account |
| **Text messages** | Only urgent things: a shift that needs coverage, a waitlist spot opening, approvals and swaps | A Twilio account and a sending number |

Each person chooses for themselves in **Profile → Notifications** (employees) or **Settings → My notifications** (staff). Texts go **only** to people who type in their mobile number and agree to receive them; that consent is recorded with the date. Anyone can reply **STOP** to opt out.

**Never paste passwords or keys into chat.** You'll put them in the app's secure settings (`.env.local` on your computer, or the hosting service's "Environment Variables" page), the same way as for Paycor ([Guide 05](05-secure-credentials.md)).

---

## Email, option A: your Microsoft 365 mailbox

Good if Goldwater uses Microsoft 365 for email. The messages come from a real Goldwater address (for example `shifts@goldwatercare.com`).

1. Ask your IT person to create (or pick) a mailbox for this, such as `shifts@goldwatercare.com`, and to **allow "Authenticated SMTP"** for that one mailbox. Microsoft turns this off by default; IT can switch it on per mailbox in the Microsoft 365 admin center (Users → the mailbox → Mail → Manage email apps → **Authenticated SMTP**).
2. Ask IT for the mailbox password (or an "app password" if they use multi-factor sign-in).
3. Put these in secure settings:

   | Setting | Value |
   |---|---|
   | `NOTIFY_EMAIL_PROVIDER` | `smtp` |
   | `SMTP_HOST` | `smtp.office365.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | the mailbox address |
   | `SMTP_PASSWORD` | the password (secret) |
   | `NOTIFY_EMAIL_FROM` | the same mailbox address |

**Tell Claude:** "Email settings saved" (no passwords), or what IT said.

## Email, option B: SendGrid

Good if IT would rather not open SMTP on a mailbox, or you expect a lot of email.

1. Sign up at sendgrid.com. Under **Settings → Sender Authentication**, verify the address or domain you'll send from (SendGrid walks you through it; IT may need to add a few DNS records).
2. Under **Settings → API Keys**, create a key with **Mail Send** permission only. Copy it straight into secure settings.
3. Settings: `NOTIFY_EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY=<the key>`, `NOTIFY_EMAIL_FROM=<the verified address>`.

## Text messages: Twilio

1. Sign up at twilio.com and buy a phone number with SMS (or create a **Messaging Service**).
2. **US business texting must be registered** ("A2P 10DLC" registration, done inside Twilio's console under Messaging → Regulatory Compliance). It asks for your company details and a sample message; approval usually takes a few days to a couple of weeks. Texts may be blocked by carriers until it's approved. For the sample message you can use: *"ShiftHQ: Urgent: shift needs coverage. CNA at Maple Grove, Thu 7:00 AM. Tap Pick Up to claim it. Reply STOP to opt out."* For how people opt in, describe: *"Employees enter their mobile number and tick a consent box in the ShiftHQ app's Profile → Notifications screen."*
3. From the Twilio console's home page, copy the **Account SID** and **Auth Token** into secure settings, plus the sending number:

   | Setting | Value |
   |---|---|
   | `NOTIFY_SMS_PROVIDER` | `twilio` |
   | `TWILIO_ACCOUNT_SID` | starts with `AC` |
   | `TWILIO_AUTH_TOKEN` | secret |
   | `TWILIO_FROM_NUMBER` | e.g. `+15555550123` (or set `TWILIO_MESSAGING_SERVICE_SID` instead) |

**Check:** run `npm run check-config`. Under **Notifications** it shows which channels are on and whether each setting is "set" or "EMPTY", never the values.

---

## How sending works (behind the scenes)
- Messages are queued and sent in the background within a couple of minutes, while people are using the app, and by the scheduled job when it's available.
- Each message is sent at most once. If a provider refuses one (wrong password, blocked number), it's marked **failed** with the reason, and nothing else is affected.
- In-app notifications never depend on email or texts working.
