import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditCtx, getActor } from "@/server/context";
import { errorMessage } from "@/server/errors";
import { exportReport, SHEET_KEYS, type SheetKey } from "@/server/report-exports";
import type { PeriodPreset } from "@/server/reports";

/** GET /api/reports/export?format=xlsx|csv&sheet=summary&preset=last_week&from=&to=&facilityId= */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  const sheet = SHEET_KEYS.includes(q.get("sheet") as SheetKey) ? (q.get("sheet") as SheetKey) : undefined;
  try {
    const out = await exportReport(await getDb(), actor, await auditCtx(actor), {
      format,
      sheet,
      filter: { preset: (q.get("preset") as PeriodPreset) ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, facilityId: q.get("facilityId") || undefined },
    });
    return new NextResponse(typeof out.body === "string" ? out.body : new Uint8Array(out.body), {
      headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400;
    return NextResponse.json({ error: errorMessage(e) }, { status });
  }
}
