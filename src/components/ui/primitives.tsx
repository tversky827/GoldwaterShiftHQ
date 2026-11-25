import * as React from "react";
import { cn } from "@/lib/utils";

/* Card ----------------------------------------------------------------- */
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-black/[0.04] bg-surface shadow-card", className)} {...p} />;
}
export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-6 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)} {...p} />;
}

/* Page header: title + one obvious primary action ------------------------ */
export function PageHeader({ title, subtitle, action, eyebrow }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] font-medium text-muted">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/* Badge ------------------------------------------------------------------ */
const tones = {
  neutral: "bg-fill text-ink-2",
  accent: "bg-accent-soft text-accent",
  positive: "bg-positive-soft text-positive",
  caution: "bg-caution-soft text-caution",
  critical: "bg-critical-soft text-critical",
} as const;
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium", tones[tone], className)} {...p} />;
}

/* Form fields --------------------------------------------------------------- */
export const inputClass =
  "h-10 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:bg-fill aria-[invalid=true]:border-critical";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...p} />
));
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(
      inputClass,
      "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236e6e73%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_12px_center] bg-no-repeat pr-9",
      className,
    )}
    {...p}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, "h-auto min-h-20 py-2.5", className)} {...p} />;
}

export function Field({ label, hint, error, children, className, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-[12px] text-critical">{error}</p> : hint ? <p className="text-[12px] text-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, description, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-1.5">
      <input type="checkbox" className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded accent-[var(--color-accent)]" {...p} />
      <span>
        <span className="block text-[15px]">{label}</span>
        {description && <span className="block text-[12px] text-muted">{description}</span>}
      </span>
    </label>
  );
}

/* Lists & tables ------------------------------------------------------------ */
export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-[14px]", className)} {...p} />
    </div>
  );
}
export function Th({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-line px-6 py-2.5 text-[12px] font-medium uppercase tracking-wide text-faint first:pl-6", className)} {...p} />;
}
export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line/70 px-6 py-3 align-middle", className)} {...p} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-fill text-muted [&_svg]:size-6">{icon}</div>}
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[14px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-2xl border border-black/[0.04] bg-surface p-5 shadow-card">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn("tabular mt-1 text-[28px] font-semibold tracking-tight", tone === "critical" && "text-critical", tone === "caution" && "text-caution", tone === "positive" && "text-positive")}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
  return (
    <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#e8e8ed] to-[#d2d2d7] text-[13px] font-semibold text-ink-2", className)}>
      {letters}
    </span>
  );
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-[12px] text-faint">{i.label}</dt>
          <dd className="mt-0.5 text-[15px]">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
