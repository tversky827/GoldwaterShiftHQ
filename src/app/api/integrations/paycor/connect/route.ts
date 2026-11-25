import { NextResponse } from "next/server";
import { getActor } from "@/server/context";
import { buildActivationUrl } from "@/server/integrations/paycor/oauth";
import { hasOrgWide } from "@/server/rbac/access";

const OAUTH_NONCE_COOKIE = "gshq_paycor_nonce";

const back = (req: Request, ok: boolean, msg: string) => {
  const u = new URL("/settings/integrations", req.url);
  u.searchParams.set("ok", ok ? "1" : "0");
  u.searchParams.set("msg", msg.slice(0, 400));
  return NextResponse.redirect(u, 303);
};

/** Starts Paycor authorization for one legal entity. */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor || !hasOrgWide(actor, "integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const legalEntityId = String((await req.formData()).get("legalEntityId") ?? "").trim();
  try {
    const { url, nonce } = buildActivationUrl(legalEntityId, actor.userId);
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(OAUTH_NONCE_COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/paycor", maxAge: 15 * 60 });
    return res;
  } catch (e) {
    return back(req, false, (e as Error).message);
  }
}
