/**
 * Authentication: login, sessions, invitations. Framework-agnostic (no
 * next/headers) so it can be unit-tested and reused by a future mobile app.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { invitations, sessions, users } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../errors";
import { hashPassword, passwordProblem, randomToken, sha256, verifyPassword } from "./password";
import { rateLimit } from "./rate-limit";

export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);
export const INVITE_TTL_DAYS = 7;
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const GENERIC_LOGIN_ERROR = "That email and password don't match. Please try again.";

export async function login(db: Db, email: string, password: string, meta: RequestMeta = {}): Promise<{ token: string; userId: string }> {
  const normalized = email.trim().toLowerCase();
  const allowedIp = await rateLimit(db, `login:ip:${meta.ipAddress ?? "unknown"}`, 30, 15 * 60);
  const allowedEmail = await rateLimit(db, `login:email:${normalized}`, 10, 15 * 60);
  if (!allowedIp || !allowedEmail) throw new AppError("Too many sign-in attempts. Please wait 15 minutes and try again.", "RATE_LIMITED", 429);

  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${normalized}`);
  const ok = await verifyPassword(password, u?.passwordHash);
  if (!u || u.status !== "active") throw new AppError(GENERIC_LOGIN_ERROR, "INVALID_LOGIN", 401);
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    throw new AppError("This account is temporarily locked after too many attempts. Try again in a few minutes.", "LOCKED", 423);
  }
  if (!ok) {
    const failed = u.failedLoginCount + 1;
    await db
      .update(users)
      .set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null })
      .where(eq(users.id, u.id));
    await audit(db, { organizationId: u.organizationId, actorUserId: u.id, ...meta }, { action: "auth.login_failed", entityType: "user", entityId: u.id });
    throw new AppError(GENERIC_LOGIN_ERROR, "INVALID_LOGIN", 401);
  }
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  const token = await createSession(db, u.id, meta);
  await audit(db, { organizationId: u.organizationId, actorUserId: u.id, ...meta }, { action: "auth.login", entityType: "user", entityId: u.id });
  return { token, userId: u.id };
}

export async function createSession(db: Db, userId: string, meta: RequestMeta = {}): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000),
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

/** Validates a session token, sliding its expiry forward. Returns the user id. */
export async function validateSession(db: Db, token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  if (!s) return null;
  const halfLife = (SESSION_TTL_HOURS * 3_600_000) / 2;
  if (s.expiresAt.getTime() - Date.now() < halfLife) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000), lastSeenAt: new Date() })
      .where(eq(sessions.id, s.id));
  }
  return s.userId;
}

export async function revokeSession(db: Db, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
}

export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Creates a one-time invitation link token for a user. Only the hash is stored. */
export async function createInvitation(db: Db, userId: string, invitedBy: string | null): Promise<string> {
  await db.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.userId, userId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const token = randomToken();
  await db.insert(invitations).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    invitedBy,
  });
  return token;
}

export async function findInvitation(db: Db, token: string) {
  const [row] = await db
    .select({ invitation: invitations, user: users })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.userId))
    .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
  return row ?? null;
}

export async function acceptInvitation(db: Db, token: string, password: string, meta: RequestMeta = {}): Promise<{ token: string; userId: string }> {
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem, "WEAK_PASSWORD");
  const inv = await findInvitation(db, token);
  if (!inv) throw new AppError("This invitation link is invalid or has expired. Ask your administrator for a new one.", "INVITE_INVALID", 410);
  if (inv.user.status === "disabled") throw new AppError("This account has been disabled.", "DISABLED", 403);
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.invitation.id));
    await tx.update(users).set({ passwordHash, status: "active", failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, inv.user.id));
    await audit(tx, { organizationId: inv.user.organizationId, actorUserId: inv.user.id, ...meta }, { action: "auth.invitation_accepted", entityType: "user", entityId: inv.user.id });
  });
  return { token: await createSession(db, inv.user.id, meta), userId: inv.user.id };
}
