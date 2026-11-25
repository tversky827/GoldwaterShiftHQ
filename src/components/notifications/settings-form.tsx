"use client";

import { useState } from "react";
import { saveMyNotificationsAction } from "@/app/notification-actions";
import { ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, Input } from "@/components/ui/primitives";

export interface NotificationSettingsValues {
  email: string;
  emailEnabled: boolean;
  mobilePhone: string | null;
  smsEnabled: boolean;
  channelsAvailable: { email: boolean; sms: boolean };
  organizationName: string;
}

/** Shows a US number as (555) 555-0123; anything else as stored. */
const pretty = (e164: string | null) => (e164 && /^\+1\d{10}$/.test(e164) ? `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}` : (e164 ?? ""));

export function NotificationSettingsForm({ v }: { v: NotificationSettingsValues }) {
  const [sms, setSms] = useState(v.smsEnabled);
  return (
    <ActionForm action={saveMyNotificationsAction} submitLabel="Save">
      <p className="text-[14px] text-muted">You always see notifications in the app. You can also get them by email and, for urgent things like a shift that needs coverage, by text message.</p>
      <Checkbox name="emailEnabled" defaultChecked={v.emailEnabled} label="Email" description={`To ${v.email}${v.channelsAvailable.email ? "" : " · email isn't switched on for your organization yet"}`} />
      <Checkbox
        name="smsEnabled"
        checked={sms}
        onChange={(e) => setSms(e.currentTarget.checked)}
        label="Text messages for urgent shift updates"
        description={v.channelsAvailable.sms ? "Shifts needing coverage, waitlist openings, approvals and swaps." : "Text messages aren't switched on for your organization yet, but you can sign up now."}
      />
      {sms && (
        <div className="space-y-3 rounded-2xl bg-fill p-4">
          <Field label="Mobile number" htmlFor="mobilePhone">
            <Input id="mobilePhone" name="mobilePhone" type="tel" inputMode="tel" autoComplete="tel" required defaultValue={pretty(v.mobilePhone)} placeholder="(555) 555-0123" />
          </Field>
          <p className="text-[12px] leading-relaxed text-muted">
            By turning this on, you agree to receive text messages about your shifts from {v.organizationName}. Message frequency varies. Message and data rates may apply. Reply STOP to any message to opt out, or turn this off here anytime.
          </p>
        </div>
      )}
      {!sms && <input type="hidden" name="mobilePhone" value={v.mobilePhone ?? ""} />}
    </ActionForm>
  );
}
