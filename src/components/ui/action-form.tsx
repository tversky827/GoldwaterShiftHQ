"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, X } from "lucide-react";
import * as React from "react";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

export type FormState = { ok: true; message?: string; data?: { link?: string } & Record<string, unknown> } | { ok: false; error: string; fieldErrors?: Record<string, string> } | null;
type ServerAction = (prev: FormState, formData: FormData) => Promise<FormState>;

const FieldErrorsContext = React.createContext<Record<string, string> | undefined>(undefined);
export const useFieldError = (name: string) => React.useContext(FieldErrorsContext)?.[name];

export function SubmitButton({ children, pendingLabel, ...p }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || p.disabled} aria-busy={pending} {...p}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </Button>
  );
}

export function CopyField({ value, label = "Invitation link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-fill p-3">
      <div className="mb-1.5 text-[12px] font-medium text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <input readOnly value={value} className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink-2 outline-none" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-faint">Single use, valid for 7 days. Send it to the person directly; it lets them set their password.</p>
    </div>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state) return null;
  if (!state.ok) return <div role="alert" className="rounded-xl bg-critical-soft px-4 py-3 text-[14px] text-critical">{state.error}</div>;
  return (
    <div className="space-y-3">
      {state.message && <div role="status" className="rounded-xl bg-positive-soft px-4 py-3 text-[14px] text-positive">{state.message}</div>}
      {state.data?.link && <CopyField value={state.data.link} />}
    </div>
  );
}

export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitVariant,
  pendingLabel,
  onSuccess,
  hideMessage,
  footer,
}: {
  action: ServerAction;
  children?: React.ReactNode;
  className?: string;
  submitLabel?: string;
  submitVariant?: ButtonProps["variant"];
  pendingLabel?: string;
  onSuccess?: (s: FormState) => void;
  hideMessage?: boolean;
  footer?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) onSuccess?.(state);
  }, [state, onSuccess]);
  return (
    <FieldErrorsContext.Provider value={state && !state.ok ? state.fieldErrors : undefined}>
      <form action={formAction} className={cn("space-y-5", className)}>
        {children}
        {!hideMessage && <FormMessage state={state} />}
        {(submitLabel || footer) && (
          <div className="flex items-center justify-end gap-2 pt-1">
            {footer}
            {submitLabel && (
              <SubmitButton variant={submitVariant} pendingLabel={pendingLabel}>
                {submitLabel}
              </SubmitButton>
            )}
          </div>
        )}
      </form>
    </FieldErrorsContext.Provider>
  );
}

/** A sheet-style dialog containing a server-action form. Closes on success unless the result has a link to show. */
export function FormDialog({
  trigger,
  title,
  description,
  action,
  submitLabel = "Save",
  children,
  destructive,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  action: ServerAction;
  submitLabel?: string;
  children?: React.ReactNode;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setKey((k) => k + 1);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface p-6 shadow-pop focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[20px] font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-[14px] text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <Button variant="quiet" size="icon" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <ActionForm
            key={key}
            action={action}
            submitLabel={submitLabel}
            submitVariant={destructive ? "destructive" : "primary"}
            onSuccess={(s) => {
              if (!(s?.ok && s.data?.link)) setOpen(false);
            }}
          >
            {children}
          </ActionForm>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A one-button form (e.g. "Sync now") that shows its result inline. */
export function ActionButton({ action, label, pendingLabel, variant, hidden }: { action: ServerAction; label: string; pendingLabel?: string; variant?: ButtonProps["variant"]; hidden?: Record<string, string> }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="contents">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant} size="sm" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      {state && (
        <div className="basis-full pt-2">
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
