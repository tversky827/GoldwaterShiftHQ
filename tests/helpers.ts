import { and, eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/db";
import { facilities, positions, shifts, users } from "@/db/schema";
import { seedDemo } from "@/db/seed/demo";
import { loadActor, type Actor } from "@/server/rbac/access";

process.env.APP_ENCRYPTION_KEY ??= "test-encryption-key";

export async function demoDb(): Promise<{ db: Db; orgId: string }> {
  const db = await createTestDb();
  const { organizationId } = await seedDemo(db, { password: "Test-Password-123", schedules: false });
  return { db, orgId: organizationId };
}

export async function actorFor(db: Db, email: string): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const a = await loadActor(db, u.id);
  if (!a) throw new Error(`no actor ${email}`);
  return a;
}

export async function facilityByCode(db: Db, code: string) {
  const [f] = await db.select().from(facilities).where(eq(facilities.code, code));
  return f;
}

export async function makeShift(db: Db, orgId: string, facilityId: string, startIso: string, hours = 8, requiredCount = 1, positionCode = "CNA") {
  const [p] = await db.select().from(positions).where(and(eq(positions.organizationId, orgId), eq(positions.code, positionCode)));
  const startsAt = new Date(startIso);
  const [s] = await db
    .insert(shifts)
    .values({ facilityId, positionId: p.id, workDate: startIso.slice(0, 10), startsAt, endsAt: new Date(startsAt.getTime() + hours * 3_600_000), paidHours: String(hours), requiredCount, source: "manual" })
    .returning();
  return s;
}

export const ctxFor = (a: Actor) => ({ organizationId: a.organizationId, actorUserId: a.userId });
