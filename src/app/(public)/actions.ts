"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { FormState } from "@/components/ui/action-form";
import { acceptInvitation, login, revokeSession } from "@/server/auth/service";
import { clearSessionCookie, requestMeta, SESSION_COOKIE, setSessionCookie } from "@/server/context";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };
  try {
    const db = await getDb();
    const { token } = await login(db, email, password, await requestMeta());
    await setSessionCookie(token);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    log.error("auth.login_error", { message: (e as Error).message });
    return { ok: false, error: "We couldn't sign you in right now. Please try again." };
  }
  redirect(safeNext(fd.get("next")));
}

export async function acceptInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { ok: false, error: "The passwords don't match.", fieldErrors: { confirm: "The passwords don't match." } };
  try {
    const db = await getDb();
    const session = await acceptInvitation(db, token, password, await requestMeta());
    await setSessionCookie(session.token);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    log.error("auth.invite_error", { message: (e as Error).message });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  redirect("/");
}

export async function signOutAction() {
  const db = await getDb();
  await revokeSession(db, (await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/login");
}
