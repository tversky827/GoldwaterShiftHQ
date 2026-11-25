import { testConnection } from "@/lib/integrations/sync";
import { back } from "../../back";

export async function POST(req: Request, { params }: { params: Promise<{ system: string }> }) {
  const { system } = await params;
  if (system !== "paycor" && system !== "aod") return new Response("Unknown system", { status: 404 });
  const r = await testConnection(system);
  const extra = r.details ? ` Details: ${JSON.stringify(r.details)}` : "";
  return back(req, r.ok, r.message + extra);
}
