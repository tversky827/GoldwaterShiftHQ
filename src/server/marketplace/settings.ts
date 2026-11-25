/** Marketplace settings: organization default, optionally replaced per facility. */
import { and, eq, isNull } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { facilities, marketplaceSettings } from "@/db/schema";
import { audit, type AuditContext } from "../audit";
import { AppError, NotFoundError } from "../errors";
import { assertCan, hasOrgWide, type Actor } from "../rbac/access";

export interface MarketplaceConfig {
  autoPublish: boolean;
  autoPublishHoursBefore: number;
  expiryHoursBefore: number;
  requireApproval: boolean;
  escalationMinutes: number[];
  /** Where these values come from. */
  source: "default" | "organization" | "facility";
}

export const DEFAULT_MARKETPLACE: MarketplaceConfig = {
  autoPublish: false,
  autoPublishHoursBefore: 72,
  expiryHoursBefore: 2,
  requireApproval: false,
  escalationMinutes: [30, 60],
  source: "default",
};

type Row = typeof marketplaceSettings.$inferSelect;
const toConfig = (r: Row, source: MarketplaceConfig["source"]): MarketplaceConfig => ({
  autoPublish: r.autoPublish,
  autoPublishHoursBefore: r.autoPublishHoursBefore,
  expiryHoursBefore: r.expiryHoursBefore,
  requireApproval: r.requireApproval,
  escalationMinutes: r.escalationMinutes.length ? r.escalationMinutes : DEFAULT_MARKETPLACE.escalationMinutes,
  source,
});

export async function marketplaceConfig(db: Db | Tx, organizationId: string, facilityId: string | null): Promise<MarketplaceConfig> {
  const rows = await db.select().from(marketplaceSettings).where(eq(marketplaceSettings.organizationId, organizationId));
  const fac = facilityId ? rows.find((r) => r.facilityId === facilityId) : undefined;
  if (fac) return toConfig(fac, "facility");
  const org = rows.find((r) => !r.facilityId);
  return org ? toConfig(org, "organization") : { ...DEFAULT_MARKETPLACE };
}

export interface MarketplaceSettingsInput {
  autoPublish: boolean;
  autoPublishHoursBefore: number;
  expiryHoursBefore: number;
  requireApproval: boolean;
  escalationMinutes: number[];
}

function validate(i: MarketplaceSettingsInput) {
  if (!Number.isInteger(i.autoPublishHoursBefore) || i.autoPublishHoursBefore < 1 || i.autoPublishHoursBefore > 720) throw new AppError("Auto-publish lead time must be between 1 and 720 hours.");
  if (!Number.isInteger(i.expiryHoursBefore) || i.expiryHoursBefore < 0 || i.expiryHoursBefore > 72) throw new AppError("Listings must close between 0 and 72 hours before the shift.");
  if (i.escalationMinutes.length !== 2 || i.escalationMinutes.some((m) => !Number.isInteger(m) || m < 5 || m > 1440)) throw new AppError("Escalation times must be between 5 and 1,440 minutes.");
}

/** facilityId null = organization default (needs org-wide marketplace.manage). */
export async function saveMarketplaceSettings(db: Db, actor: Actor, ctx: AuditContext, facilityId: string | null, input: MarketplaceSettingsInput) {
  if (facilityId) {
    const [f] = await db.select().from(facilities).where(eq(facilities.id, facilityId));
    if (!f || f.organizationId !== actor.organizationId) throw new NotFoundError("Facility");
    assertCan(actor, "marketplace.manage", { facilityId });
  } else if (!hasOrgWide(actor, "marketplace.manage")) {
    throw new AppError("Only an organization-wide administrator can change the default.", "FORBIDDEN", 403);
  }
  validate(input);
  const scope = facilityId ? eq(marketplaceSettings.facilityId, facilityId) : isNull(marketplaceSettings.facilityId);
  const values = { ...input, updatedBy: actor.userId };
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(marketplaceSettings).where(and(eq(marketplaceSettings.organizationId, actor.organizationId), scope));
    if (existing) await tx.update(marketplaceSettings).set(values).where(eq(marketplaceSettings.id, existing.id));
    else await tx.insert(marketplaceSettings).values({ organizationId: actor.organizationId, facilityId, ...values, createdBy: actor.userId });
    await audit(tx, ctx, { action: "marketplace.settings_updated", entityType: "marketplace_settings", entityId: existing?.id ?? null, facilityId, before: existing ? toConfig(existing, "organization") : null, after: input });
  });
}

/** Removes a facility's own settings so it follows the organization default again. */
export async function resetFacilityMarketplaceSettings(db: Db, actor: Actor, ctx: AuditContext, facilityId: string) {
  assertCan(actor, "marketplace.manage", { facilityId });
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(marketplaceSettings)
      .where(and(eq(marketplaceSettings.organizationId, actor.organizationId), eq(marketplaceSettings.facilityId, facilityId)))
      .returning({ id: marketplaceSettings.id });
    if (removed.length) await audit(tx, ctx, { action: "marketplace.settings_reset", entityType: "marketplace_settings", entityId: removed[0].id, facilityId });
  });
}
