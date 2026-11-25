import fs from "node:fs";
import path from "node:path";
import { getAodConfig } from "@/lib/config";
import { parseAodExport } from "@/lib/integrations/aod/file";
import { back } from "../../back";

export async function POST(req: Request) {
  const c = getAodConfig();
  if (c.mode !== "file") return back(req, false, "Uploads are only used when AOD_MODE=file.");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return back(req, false, "No file was selected.");
  if (file.size > 25 * 1024 * 1024) return back(req, false, "File is larger than 25 MB.");
  const text = await file.text();
  const parsed = parseAodExport(text, file.name);
  if (!parsed.attendance.length && !parsed.employees.length) return back(req, false, `Could not read this file. ${parsed.problems.join(" ")}`);
  fs.mkdirSync(c.exportDir, { recursive: true });
  const safe = path.basename(file.name).replace(/[^\w.-]/g, "_");
  fs.writeFileSync(path.join(c.exportDir, `${Date.now()}-${safe}`), text, { mode: 0o600 });
  return back(req, true, `Uploaded: ${parsed.employees.length} employees, ${parsed.attendance.length} attendance rows found. Click "Sync now" to import. ${parsed.problems.join(" ")}`);
}
