import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { audit } from "@/server/audit";
import { getActor, requestMeta } from "@/server/context";
import { IntegrationHttpError } from "@/server/integrations/http";
import { exchangeCode, verifyState } from "@/server/integrations/paycor/oauth";
import { hasOrgWide } from "@/server/rbac/access";

const back = (req: Request, ok: boolean, msg: string) => {
  const u = new URL("/settings/integrations", req.url);
  u.searchParams.set("ok", ok ? "1" : "0");
  u.searchParams.set("msg", msg.slice(0, 400));
  const res = NextResponse.redirect(u, 303);
  res.cookies.delete({ name: "gshq_paycor_nonce", path: "/api/integrations/paycor" });
  return res;
};

/** Paycor sends the admin's browser here after they approve (or deny) the app. */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor || !hasOrgWide(actor, "integrations.manage")) return NextResponse.redirect(new URL("/login", req.url));
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back(req, false, `Paycor did not authorize the app: ${url.searchParams.get("error")} ${url.searchParams.get("error_description") ?? ""}`);
  const state = verifyState(url.searchParams.get("state"), (await cookies()).get("gshq_paycor_nonce")?.value);
  if (!state || state.userId !== actor.userId) return back(req, false, "This authorization link expired or wasn't started from this browser. Click “Connect Paycor” again.");
  const code = url.searchParams.get("code");
  if (!code) return back(req, false, "Paycor returned without an authorization code. Try “Connect Paycor” again.");
  try {
    const db = await getDb();
    await exchangeCode(db, actor.organizationId, state.legalEntityId, code, actor.userId);
    await audit(db, { organizationId: actor.organizationId, actorUserId: actor.userId, ...(await requestMeta()) }, { action: "integration.paycor.authorized", entityType: "integration", after: { legalEntityId: state.legalEntityId } });
    return back(req, true, `Paycor authorized for legal entity ${state.legalEntityId}. Next: click “Test connection”.`);
  } catch (e) {
    return back(req, false, `Couldn't finish connecting to Paycor: ${e instanceof IntegrationHttpError ? e.plainEnglish : (e as Error).message}`);
  }
}
