"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/fields";
import { acceptInviteAction } from "../../actions";

export function InviteForm({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInviteAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <TextField label="Create a password" name="password" type="password" autoComplete="new-password" minLength={10} hint="At least 10 characters." required autoFocus />
      <TextField label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
      <SubmitButton className="w-full" size="lg" pendingLabel="Setting up…">
        Continue
      </SubmitButton>
    </ActionForm>
  );
}
