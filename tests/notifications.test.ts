import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { notifications, users } from "@/db/schema";
import { clearProviders, deliverPending, myNotificationSettings, normalizePhone, notify, registerProvider, saveMyNotificationSettings } from "@/server/notifications";
import { sendgridProvider, smsText, twilioProvider, type NotificationProvider, type Recipient } from "@/server/notify-providers";
import type { Actor } from "@/server/rbac/access";
import { actorFor, ctxFor, demoDb } from "./helpers";

let db: Db;
let orgId: string;
let emp: Actor, sched: Actor;

const sent: { channel: string; to: Recipient; title: string }[] = [];
const fake = (channel: "email" | "sms", fail = false): NotificationProvider => ({
  channel,
  name: `fake-${channel}`,
  async send(to, m) {
    if (fail) throw new Error("provider down");
    sent.push({ channel, to, title: m.title });
  },
});

beforeAll(async () => {
  ({ db, orgId } = await demoDb());
  emp = await actorFor(db, "employee@demo.test");
  sched = await actorFor(db, "scheduler@demo.test");
});
afterEach(() => {
  clearProviders();
  sent.length = 0;
});

const pendingFor = (userId: string) => db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.status, "pending")));

describe("email and text notifications", () => {
  it("normalizes phone numbers", () => {
    expect(normalizePhone("(555) 555-0123")).toBe("+15555550123");
    expect(normalizePhone("1-555-555-0123")).toBe("+15555550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("with no provider configured, only in-app notifications are written", async () => {
    await notify(db, { organizationId: orgId, userIds: [emp.userId], category: "callout_coverage", title: "T", body: "B" });
    const rows = await db.select().from(notifications).where(eq(notifications.userId, emp.userId));
    expect(rows.every((r) => r.channel === "in_app")).toBe(true);
  });

  it("queues email by default, but texts only with a number, consent and an urgent category", async () => {
    registerProvider(fake("email"));
    registerProvider(fake("sms"));
    await notify(db, { organizationId: orgId, userIds: [emp.userId], category: "callout_coverage", title: "Urgent", body: "B" });
    expect((await pendingFor(emp.userId)).map((r) => r.channel)).toEqual(["email"]); // no consent yet

    await expect(saveMyNotificationSettings(db, emp, ctxFor(emp), { emailEnabled: true, smsEnabled: true, mobilePhone: "" })).rejects.toThrow(/mobile number/);
    await saveMyNotificationSettings(db, emp, ctxFor(emp), { emailEnabled: true, smsEnabled: true, mobilePhone: "(555) 555-0123" });
    const [u] = await db.select().from(users).where(eq(users.id, emp.userId));
    expect(u.mobilePhone).toBe("+15555550123");
    expect(u.smsConsentAt).not.toBeNull();
    expect((await myNotificationSettings(db, emp)).smsEnabled).toBe(true);

    await notify(db, { organizationId: orgId, userIds: [emp.userId], category: "callout_coverage", title: "Urgent 2", body: "B" });
    await notify(db, { organizationId: orgId, userIds: [emp.userId], category: "open_shift", title: "Routine", body: "B" }); // not texted
    const r = await deliverPending(db);
    expect(r.failed).toBe(0);
    expect(sent.filter((s) => s.channel === "sms").map((s) => s.title)).toEqual(["Urgent 2"]);
    expect(sent.filter((s) => s.channel === "email").map((s) => s.title).sort()).toEqual(["Routine", "Urgent", "Urgent 2"]);
    expect(sent.find((s) => s.channel === "sms")?.to.mobilePhone).toBe("+15555550123");
    // Nothing is ever sent twice.
    expect((await deliverPending(db)).sent).toBe(0);
  });

  it("respects turning a channel off, and withdrawing text consent", async () => {
    registerProvider(fake("email"));
    registerProvider(fake("sms"));
    await saveMyNotificationSettings(db, emp, ctxFor(emp), { emailEnabled: false, smsEnabled: false, mobilePhone: "(555) 555-0123" });
    const [u] = await db.select().from(users).where(eq(users.id, emp.userId));
    expect(u.smsConsentAt).toBeNull();
    await notify(db, { organizationId: orgId, userIds: [emp.userId], category: "callout_coverage", title: "X", body: "B" });
    expect(await pendingFor(emp.userId)).toEqual([]);
  });

  it("records a provider failure and doesn't retry it endlessly", async () => {
    registerProvider(fake("email", true));
    await notify(db, { organizationId: orgId, userIds: [sched.userId], category: "claim_review", title: "Review", body: "B" });
    const r = await deliverPending(db);
    expect(r.failed).toBe(1);
    const [n] = await db.select().from(notifications).where(and(eq(notifications.userId, sched.userId), eq(notifications.channel, "email")));
    expect(n.status).toBe("failed");
    expect(n.failureReason).toBe("provider down");
  });
});

describe("provider request formats", () => {
  const to: Recipient = { userId: "u", email: "a@example.test", displayName: "Ana Diaz", mobilePhone: "+15555550123" };
  const msg = { title: "Shift needs coverage", body: "CNA at Maple Grove, Thu 7:00 AM.", link: "https://app.example.test/app/shifts" };

  it("Twilio: form-encoded Messages request with basic auth", async () => {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550001111" });
    let req: { url: string; init: RequestInit } | undefined;
    const p = twilioProvider((async (url: string, init: RequestInit) => ((req = { url, init }), new Response("{}", { status: 201 }))) as unknown as typeof fetch)!;
    await p.send(to, msg);
    expect(req!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((req!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:tok").toString("base64")}`);
    const body = new URLSearchParams(String(req!.init.body));
    expect(body.get("To")).toBe("+15555550123");
    expect(body.get("From")).toBe("+15550001111");
    expect(body.get("Body")).toContain("Reply STOP to opt out.");
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  it("SendGrid: v3 mail send JSON with bearer key; errors are reported", async () => {
    Object.assign(process.env, { SENDGRID_API_KEY: "SG.key", NOTIFY_EMAIL_FROM: "shifts@example.test" });
    let req: { url: string; init: RequestInit } | undefined;
    const ok = sendgridProvider((async (url: string, init: RequestInit) => ((req = { url, init }), new Response("", { status: 202 }))) as unknown as typeof fetch)!;
    await ok.send(to, msg);
    expect(req!.url).toBe("https://api.sendgrid.com/v3/mail/send");
    const j = JSON.parse(String(req!.init.body));
    expect(j.personalizations[0].to[0].email).toBe("a@example.test");
    expect(j.from.email).toBe("shifts@example.test");
    expect(j.content[0].value).toContain(msg.link);
    const bad = sendgridProvider((async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch)!;
    await expect(bad.send(to, msg)).rejects.toThrow(/HTTP 403/);
    delete process.env.SENDGRID_API_KEY;
    delete process.env.NOTIFY_EMAIL_FROM;
  });

  it("keeps texts short and always includes the opt-out", () => {
    const t = smsText({ title: "T", body: "x".repeat(1000), link: "https://a.test/app" });
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t.endsWith("Reply STOP to opt out.")).toBe(true);
  });
});
