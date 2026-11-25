import { resolveError } from "@/lib/integrations/sync";
import { back } from "../../../back";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  resolveError((await params).id);
  return back(req, true, "Error marked as resolved.");
}
