import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { BrandMark } from "@/components/brand";
import { DEMO_PASSWORD_DEFAULT, DEMO_USERS } from "@/db/seed/demo";
import { getActor } from "@/server/context";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getActor()) redirect("/");
  const { next } = await searchParams;
  const db = await getDb();
  const showDemo = process.env.APP_ENV !== "production" && (await db.select({ id: users.id }).from(users).where(eq(users.isDemo, true)).limit(1)).length > 0;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-14" />
          <h1 className="mt-5 text-[28px] font-semibold tracking-tight">Sign in to ShiftHQ</h1>
          <p className="mt-1 text-[15px] text-muted">Scheduling for every facility, in one place.</p>
        </div>
        <div className="rounded-3xl border border-black/[0.04] bg-surface p-7 shadow-card">
          <LoginForm next={next} />
        </div>
        <p className="mt-6 text-center text-[13px] text-muted">New here? Use the invitation link your scheduler or administrator sent you.</p>

        {showDemo && (
          <details className="mt-8 rounded-2xl border border-dashed border-line-strong bg-surface/60 p-4 text-[13px]">
            <summary className="cursor-pointer font-medium text-ink-2">Demonstration accounts</summary>
            <p className="mt-2 text-muted">
              Password for all: <code className="rounded bg-fill px-1.5 py-0.5">{process.env.DEMO_PASSWORD ? "(DEMO_PASSWORD)" : DEMO_PASSWORD_DEFAULT}</code>
            </p>
            <ul className="mt-2 space-y-1 text-ink-2">
              {DEMO_USERS.map((u) => (
                <li key={u.email} className="flex justify-between gap-3">
                  <span className="font-mono text-[12px]">{u.email}</span>
                  <span className="text-muted">{u.role.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </main>
  );
}
