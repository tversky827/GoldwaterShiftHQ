"use client";

import * as React from "react";
import { useFieldError } from "./action-form";
import { Field, Input, Select, Textarea } from "./primitives";

/** Text input that shows the server's field error for `name`. */
export function TextField({ label, name, hint, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string }) {
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Input id={id} name={name} aria-invalid={!!error} {...p} />
    </Field>
  );
}

export function SelectField({ label, name, hint, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string; hint?: string }) {
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Select id={id} name={name} aria-invalid={!!error} {...p}>
        {children}
      </Select>
    </Field>
  );
}

export function TextAreaField({ label, name, hint, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string; hint?: string }) {
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Textarea id={id} name={name} aria-invalid={!!error} {...p} />
    </Field>
  );
}
