import { runAodSync, runPaycorSync } from "@/lib/integrations/sync";
import { back } from "../../back";

export async function POST(req: Request, { params }: { params: Promise<{ system: string }> }) {
  const { system } = await params;
  if (system !== "paycor" && system !== "aod") return new Response("Unknown system", { status: 404 });
  const r = system === "paycor" ? await runPaycorSync() : await runAodSync();
  return back(req, r.ok, r.message);
}
