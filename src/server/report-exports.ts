/**
 * Report exports: an Excel workbook (every report, one sheet each, plus an
 * "About" sheet explaining each figure) or a CSV of one report.
 * Requires `reports.export`; every export is written to the audit log
 * (what, which period, which facility; never the data itself).
 * Spreadsheet safety: text cells that start with = + - @ are prefixed with an
 * apostrophe so a spreadsheet never treats them as formulas.
 */
import type { Db } from "@/db";
import { audit, type AuditContext } from "./audit";
import { AppError, ForbiddenError } from "./errors";
import { facilityScope, type Actor } from "./rbac/access";
import { laborReport, type LaborReport, type ReportFilter } from "./reports";

type Cell = string | number | null;
export interface Sheet {
  key: string;
  name: string;
  columns: { header: string; width?: number; numFmt?: string }[];
  rows: Cell[][];
}

export const SHEET_KEYS = ["summary", "coverage", "overtime", "open_shifts", "callouts"] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

const local = (d: Date | null | undefined, tz: string) => {
  if (!d) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
};
const pctCell = (v: number | null) => (v === null ? null : Math.round(v * 10) / 1000);

export function buildSheets(r: LaborReport): Sheet[] {
  const H = "0.0";
  const P = "0.0%";
  const summary: Sheet = {
    key: "summary",
    name: "Summary",
    columns: [
      { header: "Facility", width: 34 },
      { header: "Code", width: 8 },
      { header: "Budget hours", numFmt: H },
      { header: "Required hours", numFmt: H },
      { header: "Scheduled hours", numFmt: H },
      { header: "Clocked hours", numFmt: H },
      { header: "Approved clocked hours", numFmt: H },
      { header: "Scheduled vs budget", numFmt: P },
      { header: "Clocked vs scheduled", numFmt: P },
      { header: "Required openings" },
      { header: "Filled openings" },
      { header: "Fill rate", numFmt: P },
      { header: "Overtime hours (estimate)", numFmt: H },
      { header: "Regional pool hours", numFmt: H },
      { header: "Open shifts published" },
      { header: "Open shifts filled" },
      { header: "Median hours to fill", numFmt: H },
      { header: "Callouts" },
      { header: "Callouts covered" },
      { header: "Median minutes to cover" },
    ],
    rows: [...r.facilities.map((f) => ({ ...f, label: f.name })), { ...r.totals, label: "All selected facilities", code: "" }].map((f) => [
      f.label,
      "code" in f ? (f.code as string) : "",
      f.budgetHours,
      f.requiredHours,
      f.scheduledHours,
      f.clockedHours,
      f.approvedHours,
      pctCell(f.scheduledVsBudget),
      pctCell(f.clockedVsScheduled),
      f.requiredSlots,
      f.filledSlots,
      pctCell(f.fillRate),
      f.overtimeHours,
      f.poolHours,
      f.listingsPublished,
      f.listingsFilled,
      f.medianHoursToFill,
      f.callouts,
      f.calloutsCovered,
      f.medianMinutesToCover,
    ]),
  };
  const coverage: Sheet = {
    key: "coverage",
    name: "Coverage",
    columns: [{ header: "Facility", width: 8 }, { header: "Date", width: 12 }, { header: "Starts", width: 17 }, { header: "Ends", width: 17 }, { header: "Position" }, { header: "Required" }, { header: "Filled" }, { header: "Open" }, { header: "Regional pool" }, { header: "Paid hours", numFmt: H }, { header: "Source" }],
    rows: r.detail.shifts.map((s) => [s.facility.code, s.workDate, local(s.startsAt, s.facility.timezone), local(s.endsAt, s.facility.timezone), s.positionCode, s.required, Math.min(s.filled, s.required), Math.max(0, s.required - s.filled), s.poolFilled, s.paid, s.source]),
  };
  const overtime: Sheet = {
    key: "overtime",
    name: "Overtime",
    columns: [{ header: "Employee", width: 26 }, { header: "Employee #" }, { header: "Workweek starting", width: 16 }, { header: "Hours (all facilities)", numFmt: H }, { header: "Overtime hours (estimate)", numFmt: H }, { header: "Facilities", width: 20 }],
    rows: r.overtime.map((o) => [o.name, o.employeeNumber, o.weekStart, o.hours, o.overtime, o.facilities]),
  };
  const open: Sheet = {
    key: "open_shifts",
    name: "Open shifts",
    columns: [{ header: "Facility", width: 8 }, { header: "Published", width: 17 }, { header: "Shift starts", width: 17 }, { header: "Position" }, { header: "Status" }],
    rows: r.detail.listings.map((l) => [l.facility.code, local(l.publishAt, l.facility.timezone), local(l.shiftStart, l.facility.timezone), l.positionCode, l.status]),
  };
  const cos: Sheet = {
    key: "callouts",
    name: "Callouts",
    columns: [{ header: "Facility", width: 8 }, { header: "Reported", width: 17 }, { header: "Shift starts", width: 17 }, { header: "Position" }, { header: "Employee", width: 24 }, { header: "Reason", width: 30 }, { header: "Outcome" }, { header: "Escalation level" }, { header: "Minutes to cover" }],
    rows: r.detail.callouts.map((c) => [c.facility.code, local(c.createdAt, c.facility.timezone), local(c.startsAt, c.facility.timezone), c.positionCode, `${c.first} ${c.last}`, c.reason ?? "", c.status, c.escalationLevel, c.status === "covered" && c.resolvedAt ? Math.round((c.resolvedAt.getTime() - c.createdAt.getTime()) / 60_000) : null]),
  };
  return [summary, coverage, overtime, open, cos];
}

export function aboutRows(r: LaborReport, actor: Actor): Cell[][] {
  return [
    ["ShiftHQ labor report"],
    ["Period", r.period.label],
    ["Facilities", r.scope.selected ? (r.facilities[0]?.name ?? "") : `${r.facilities.length} (all you have access to)`],
    ["Generated", local(new Date(), r.timeZone)],
    ["Generated by", actor.displayName],
    [],
    ["Budget hours", "Hours planned in the facility's staffing budget for each day of the period."],
    ["Required hours", "Hours of the shifts actually built for the period (budget plus any extra or callout shifts)."],
    ["Scheduled hours", "Hours of people assigned to those shifts."],
    ["Clocked hours", "Hours punched in timekeeping (Attendance on Demand). Approved = marked approved there."],
    ["Fill rate", "Filled openings divided by required openings."],
    ["Overtime (estimate)", `Per person per workweek across ALL facilities: hours over ${r.overtimeThreshold ?? "the overtime threshold"} (clocked hours for past days, scheduled for later), split across facilities by where they worked. ${r.rulesConfirmed ? "" : "The overtime rule is still an example value until confirmed in Settings → Rules. "}Payroll (Paycor) remains the official source.`],
    ["Median hours to fill", "From when an open shift was published to when a pick-up was approved."],
    ["Median minutes to cover", "From when a callout was recorded to when someone picked up the shift."],
  ];
}

const safe = (v: Cell) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function toCsv(sheet: Sheet): string {
  const esc = (v: Cell) => {
    const s = v === null || v === undefined ? "" : String(safe(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const isPct = sheet.columns.map((c) => c.numFmt === "0.0%");
  const lines = [sheet.columns.map((c) => esc(c.header)).join(","), ...sheet.rows.map((r) => r.map((v, i) => esc(isPct[i] && typeof v === "number" ? Math.round(v * 1000) / 10 : v)).join(","))];
  // Byte-order mark so Excel opens UTF-8 (names with accents) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(sheets: Sheet[], about: Cell[][]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ShiftHQ";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.header, width: c.width ?? Math.max(10, Math.min(28, c.header.length + 2)), style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(r.map(safe));
    if (s.key === "summary" && s.rows.length) ws.getRow(s.rows.length + 1).font = { bold: true };
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  const a = wb.addWorksheet("About");
  a.columns = [{ width: 26 }, { width: 110 }];
  for (const r of about) a.addRow(r.map(safe));
  a.getRow(1).font = { bold: true, size: 14 };
  a.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportReport(db: Db, actor: Actor, ctx: AuditContext, input: { filter: ReportFilter; format: "xlsx" | "csv"; sheet?: SheetKey }) {
  const scope = facilityScope(actor, "reports.export");
  if (scope !== "all" && !scope.length) throw new ForbiddenError();
  if (input.filter.facilityId && scope !== "all" && !scope.includes(input.filter.facilityId)) throw new ForbiddenError();
  // Without org-wide export rights, an "all facilities" export is limited to the facilities you can export.
  const report = await laborReport(db, actor, input.filter);
  if (scope !== "all" && report.facilities.some((f) => !scope.includes(f.id))) throw new ForbiddenError("You can export reports only for your own facilities. Choose one facility.");
  const sheets = buildSheets(report);
  const stamp = `${report.period.from}_to_${report.period.to}`;
  const where = report.scope.selected ? (report.facilities[0]?.code ?? "facility") : "all-facilities";
  let out: { filename: string; contentType: string; body: Buffer | string };
  if (input.format === "csv") {
    const s = sheets.find((x) => x.key === (input.sheet ?? "summary"));
    if (!s) throw new AppError("Unknown report.");
    out = { filename: `shifthq-${s.key.replace("_", "-")}-${where}-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(s) };
  } else {
    out = { filename: `shifthq-labor-report-${where}-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await toXlsx(sheets, aboutRows(report, actor)) };
  }
  await audit(db, ctx, { action: "report.exported", entityType: "report", facilityId: report.scope.selected, after: { format: input.format, sheet: input.format === "csv" ? (input.sheet ?? "summary") : "all", period: { from: report.period.from, to: report.period.to }, facilities: report.facilities.length } });
  return out;
}
