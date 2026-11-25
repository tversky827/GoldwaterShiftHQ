/**
 * Email and text-message providers. Chosen by environment variables, so the
 * owner can use either, both, or neither:
 *
 *   Email  NOTIFY_EMAIL_PROVIDER=smtp      any SMTP mailbox, e.g. Microsoft 365
 *                                          (SMTP_HOST=smtp.office365.com, SMTP_PORT=587)
 *          NOTIFY_EMAIL_PROVIDER=sendgrid  SendGrid (SENDGRID_API_KEY)
 *          plus NOTIFY_EMAIL_FROM          the sender address
 *   Texts  NOTIFY_SMS_PROVIDER=twilio      Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *                                          and TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID)
 *   Either NOTIFY_*_PROVIDER=log           development only: writes to the server log
 *
 * Secrets are read from the environment at send time and never logged.
 */
import { fetchWithRetry, redact } from "./integrations/http";
import { log } from "./log";

export type ExternalChannel = "email" | "sms" | "push";

export interface Recipient {
  userId: string;
  email: string;
  displayName: string;
  mobilePhone: string | null;
}
export interface OutgoingMessage {
  title: string;
  body: string;
  /** Absolute link into the app, added to emails and texts. */
  link: string;
}

export interface NotificationProvider {
  channel: ExternalChannel;
  name: string;
  send(to: Recipient, msg: OutgoingMessage): Promise<void>;
}

const env = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

export function logProvider(channel: ExternalChannel): NotificationProvider {
  return {
    channel,
    name: "log",
    async send(to, msg) {
      log.info("notification.log_provider", { channel, userId: to.userId, title: msg.title });
    },
  };
}

const emailText = (to: Recipient, m: OutgoingMessage) =>
  `Hi ${to.displayName.split(" ")[0]},\n\n${m.body}\n\nOpen ShiftHQ: ${m.link}\n\nYou can change which messages you get in ShiftHQ under Profile, Notifications.`;

export function smtpProvider(): NotificationProvider | undefined {
  const host = env("SMTP_HOST");
  const from = env("NOTIFY_EMAIL_FROM");
  if (!host || !from) return undefined;
  let transport: Promise<{ sendMail: (o: Record<string, unknown>) => Promise<unknown> }> | undefined;
  return {
    channel: "email",
    name: "smtp",
    async send(to, m) {
      transport ??= import("nodemailer").then((nm) =>
        nm.createTransport({
          host,
          port: Number(env("SMTP_PORT") ?? 587),
          secure: Number(env("SMTP_PORT") ?? 587) === 465,
          requireTLS: Number(env("SMTP_PORT") ?? 587) !== 465,
          auth: env("SMTP_USER") ? { user: env("SMTP_USER")!, pass: env("SMTP_PASSWORD") ?? "" } : undefined,
        }),
      );
      await (await transport).sendMail({ from, to: to.email, subject: m.title, text: emailText(to, m) });
    },
  };
}

/** SendGrid v3 Mail Send API. */
export function sendgridProvider(fetchImpl: typeof fetch = fetch): NotificationProvider | undefined {
  const key = env("SENDGRID_API_KEY");
  const from = env("NOTIFY_EMAIL_FROM");
  if (!key || !from) return undefined;
  return {
    channel: "email",
    name: "sendgrid",
    async send(to, m) {
      const res = await fetchWithRetry(
        "https://api.sendgrid.com/v3/mail/send",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ personalizations: [{ to: [{ email: to.email, name: to.displayName }] }], from: { email: from, name: env("NOTIFY_EMAIL_FROM_NAME") ?? "ShiftHQ" }, subject: m.title, content: [{ type: "text/plain", value: emailText(to, m) }] }),
        },
        { retries: 2, retryServerErrors: false, fetchImpl },
      );
      if (!res.ok) throw new Error(`SendGrid returned HTTP ${res.status}: ${redact(await res.text().catch(() => ""))}`);
    },
  };
}

/** Twilio Programmable Messaging (Messages resource). */
export function twilioProvider(fetchImpl: typeof fetch = fetch): NotificationProvider | undefined {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const fromNumber = env("TWILIO_FROM_NUMBER");
  const service = env("TWILIO_MESSAGING_SERVICE_SID");
  if (!sid || !token || (!fromNumber && !service)) return undefined;
  return {
    channel: "sms",
    name: "twilio",
    async send(to, m) {
      if (!to.mobilePhone) throw new Error("No mobile number on file.");
      const body = new URLSearchParams({ To: to.mobilePhone, Body: smsText(m), ...(service ? { MessagingServiceSid: service } : { From: fromNumber! }) });
      const res = await fetchWithRetry(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body },
        { retries: 2, retryServerErrors: false, fetchImpl },
      );
      if (!res.ok) throw new Error(`Twilio returned HTTP ${res.status}: ${redact(await res.text().catch(() => ""))}`);
    },
  };
}

/** Short, single-segment-friendly text with the opt-out reminder. */
export function smsText(m: OutgoingMessage) {
  const core = `ShiftHQ: ${m.title}. ${m.body}`.replace(/\s+/g, " ").trim();
  const tail = ` ${m.link} Reply STOP to opt out.`;
  const max = 300 - tail.length;
  return (core.length > max ? `${core.slice(0, max - 1)}…` : core) + tail;
}

/** The provider configured for a channel, if any. */
export function providerFromEnv(channel: ExternalChannel): NotificationProvider | undefined {
  const kind = env(`NOTIFY_${channel.toUpperCase()}_PROVIDER`);
  if (!kind) return undefined;
  if (kind === "log") return process.env.APP_ENV === "production" ? undefined : logProvider(channel);
  if (channel === "email" && kind === "smtp") return smtpProvider();
  if (channel === "email" && kind === "sendgrid") return sendgridProvider();
  if (channel === "sms" && kind === "twilio") return twilioProvider();
  log.warn("notification.unknown_provider", { channel, kind });
  return undefined;
}
