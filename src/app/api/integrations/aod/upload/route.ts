import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { audit } from "@/server/audit";
import { getActor, requestMeta } from "@/server/context";
import { parseAodExport } from "@/server/integrations/aod/file";
import { getAodConfig } from "@/server/integrations/config";
import { hasOrgWide } from "@/server/rbac/access";

const back = (req: Request, ok: boolean, msg: string) => {
  const u = new URL("/settings/integrations", req.url);
  u.searchParams.set("ok", ok ? "1" : "0");
  u.searchParams.set("msg", msg.slice(0, 400));
  return NextResponse.redirect(u, 303);
};

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor || !hasOrgWide(actor, "integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const c = getAodConfig();
  if (c.mode !== "file") return back(req, false, "Uploads are only used when AOD_MODE=file.");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return back(req, false, "No file was selected.");
  if (file.size > 25 * 1024 * 1024) return back(req, false, "File is larger than 25 MB.");
  const text = await file.text();
  const parsed = parseAodExport(text, file.name);
  if (!parsed.attendance.length && !parsed.employees.length) return back(req, false, `Couldn't read this file. ${parsed.problems.join(" ")}`);
  fs.mkdirSync(c.exportDir, { recursive: true });
  fs.writeFileSync(path.join(c.exportDir, `${Date.now()}-${path.basename(file.name).replace(/[^\w.-]/g, "_")}`), text, { mode: 0o600 });
  await audit(await getDb(), { organizationId: actor.organizationId, actorUserId: actor.userId, ...(await requestMeta()) }, { action: "integration.aod.file_uploaded", entityType: "integration", after: { rows: parsed.attendance.length } });
  return back(req, true, `Uploaded: ${parsed.attendance.length} attendance rows found. Click “Sync now” to import. ${parsed.problems.join(" ")}`);
}
