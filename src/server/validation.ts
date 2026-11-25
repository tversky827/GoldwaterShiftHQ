import type { z } from "zod";

/** Parse FormData with a zod schema; returns data or a form-friendly error result. */
export function parseForm<S extends z.ZodTypeAny>(schema: S, fd: FormData): { ok: true; data: z.infer<S> } | { ok: false; error: string; fieldErrors: Record<string, string> } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    raw[k] = typeof v === "string" ? v : v;
  }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
}
