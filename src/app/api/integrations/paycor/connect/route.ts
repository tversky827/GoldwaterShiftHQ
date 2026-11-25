import { NextResponse } from "next/server";
import { buildActivationUrl } from "@/lib/integrations/paycor/oauth";
import { back } from "../../back";

export async function POST(req: Request) {
  const form = await req.formData();
  const le = Number(form.get("legalEntityId"));
  try {
    return NextResponse.redirect(buildActivationUrl(Number.isFinite(le) && le > 0 ? le : null), 303);
  } catch (e) {
    return back(req, false, (e as Error).message);
  }
}
