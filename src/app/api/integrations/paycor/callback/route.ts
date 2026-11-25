import { consumeState, exchangeCode } from "@/lib/integrations/paycor/oauth";
import { IntegrationHttpError } from "@/lib/integrations/http";
import { back } from "../../back";

/** Paycor sends the admin's browser here after they approve the app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back(req, false, `Paycor did not authorize the app: ${error} ${url.searchParams.get("error_description") ?? ""}`);
  const { ok, legalEntityHint } = consumeState(url.searchParams.get("state"));
  if (!ok) return back(req, false, "This authorization link expired or was not started from this dashboard. Click 'Connect Paycor' again.");
  const code = url.searchParams.get("code");
  if (!code) return back(req, false, "Paycor returned without an authorization code. Try 'Connect Paycor' again.");
  try {
    await exchangeCode(code, legalEntityHint);
    return back(req, true, `Paycor authorized${legalEntityHint ? ` for legal entity ${legalEntityHint}` : ""}. Next: click "Test connection".`);
  } catch (e) {
    const msg = e instanceof IntegrationHttpError ? e.plainEnglish : (e as Error).message;
    return back(req, false, `Could not finish connecting to Paycor: ${msg}`);
  }
}
