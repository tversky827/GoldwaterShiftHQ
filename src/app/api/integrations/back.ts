import { NextResponse } from "next/server";

/** Redirect back to the dashboard with a plain-English message (never secrets). */
export function back(req: Request, ok: boolean, msg: string) {
  const url = new URL("/admin/integrations", req.url);
  url.searchParams.set("ok", ok ? "1" : "0");
  url.searchParams.set("msg", msg.slice(0, 600));
  return NextResponse.redirect(url, 303);
}
