import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb, type Db } from "@/db";
import type { AuditContext } from "./audit";
import { validateSession, type RequestMeta } from "./auth/service";
import { AppError, errorMessage } from "./errors";
import { log } from "./log";
import { assertCan, isStaff, loadActor, type Actor, type Target } from "./rbac/access";
import type { Permission } from "./rbac/catalog";

export const SESSION_COOKIE = "gshq_session";

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent"),
  };
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in actor for this request (memoized per request), or null. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const db = await getDb();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = await validateSession(db, token);
  return userId ? loadActor(db, userId) : null;
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function requireStaff(): Promise<Actor> {
  const actor = await requireActor();
  if (!isStaff(actor)) redirect("/app");
  return actor;
}

/** For pages: redirect to an access-denied page instead of throwing. */
export async function requirePermission(perm: Permission, target?: Target): Promise<Actor> {
  const actor = await requireActor();
  try {
    assertCan(actor, perm, target);
  } catch {
    redirect("/forbidden");
  }
  return actor;
}

export async function auditCtx(actor: Actor): Promise<AuditContext> {
  return { organizationId: actor.organizationId, actorUserId: actor.userId, ...(await requestMeta()) };
}

export type ActionResult<T = { link?: string } & Record<string, unknown>> = { ok: true; message?: string; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Wraps a server action: requires a signed-in user, converts thrown errors
 * into a friendly result, and logs unexpected failures without leaking details.
 */
export async function runAction<T extends Record<string, unknown> = { link?: string } & Record<string, unknown>>(fn: (ctx: { db: Db; actor: Actor; audit: AuditContext }) => Promise<ActionResult<T> | void>): Promise<ActionResult<T>> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Your session has expired. Please sign in again." };
  try {
    const db = await getDb();
    const res = await fn({ db, actor, audit: await auditCtx(actor) });
    return res ?? { ok: true };
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (!(e instanceof AppError)) log.error("action.failed", { message: (e as Error)?.message, userId: actor.userId });
    return { ok: false, error: errorMessage(e) };
  }
}
