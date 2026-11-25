"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/fields";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <TextField label="Email" name="email" type="email" autoComplete="username" inputMode="email" autoFocus required />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton className="w-full" size="lg" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
