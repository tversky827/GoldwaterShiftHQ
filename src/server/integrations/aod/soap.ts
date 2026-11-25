/**
 * Attendance on Demand Web Services (Client Contract 1, "CC1") - SOAP. READ ONLY.
 *
 * Verified against AOD's web-services documentation (attendanceondemand.com/webservices,
 * read 2026-11-25) and Goldwater's own WSDL:
 *   - HTTPS on the standard port 443 (older material said 8192).
 *   - WSDL (no login):  https://<client>.attendanceondemand.com:443/cc1.aew/wsdl/IAeXMLBridge
 *   - Endpoint (basic auth with the AOD Access Account): /cc1exec.aew/soap/IAeXMLBridge
 *   - SOAP 1.1, RPC/encoded; method namespace urn:AeXMLBridgeIntf-IAeXMLBridge;
 *     data types in urn:AeXMLBridgeIntf; soapAction "urn:AeXMLBridgeIntf-IAeXMLBridge#<method>".
 *
 * Methods used (all READ; this client never calls a WRITE method):
 *   getCompanyName                     credential check in "Test connection"
 *   getActiveEmployeesCount            shown in "Test connection"
 *   getHyperQueriesSimple              names of saved employee lists (HyperQueries)
 *   getAllEmployeesList                TAeEmployeeBasic[]: EmpID, Badge, Filekey,
 *                                      ActiveStatus (0 active, 1 inactive), DateOfHire
 *                                      (yyyy-mm-dd), FirstName, LastName, WGDescr
 *                                      (usually the first three workgroups)
 *   extractRangedTransactionsUsingHyperQuery(HyperQueryName, DateRangeEnum, MinDate, MaxDate)
 *                                      TAeEmpTransaction[] = employee fields + TimeStamp
 *                                      ("yyyy-mm-dd HH:mm:ss:fff", local time), Station,
 *                                      TransType. Only CURRENT and PREVIOUS pay periods.
 * TransType (low byte): 0 punch (in/out decided by the clock), 1 punch transfer, 2 transfer,
 * 3 in, 4 out, 5 access, 7 punch access; flags 256 start of shift, 512 end of shift,
 * 1024 not start of shift, 2048 added (edited) transaction.
 */
import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { zonedToUtc } from "@/lib/tz";
import { getAodConfig, type AodConfig } from "../config";
import { explainHttpStatus, fetchWithRetry, IntegrationHttpError, redact } from "../http";
import type { AodEmployee, AodSource, AttendanceRecord, ConnectionTestResult } from "./types";

const METHOD_NS = "urn:AeXMLBridgeIntf-IAeXMLBridge";
const TYPES_NS = "urn:AeXMLBridgeIntf";

/** Only these methods may ever be called by this client (all read-only). */
export const READ_ONLY_METHODS = new Set(["getCompanyName", "getActiveEmployeesCount", "getHyperQueriesSimple", "getAllEmployeesList", "getActiveEmployeesList", "extractRangedTransactionsUsingHyperQuery"]);

export function aodUrls(c: AodConfig) {
  if (!c.hostname) throw new Error("AOD_HOSTNAME is not set.");
  const root = `https://${c.hostname}:${c.port}`;
  return { wsdl: `${root}/cc1.aew/wsdl/IAeXMLBridge`, soap: `${root}/cc1exec.aew/soap/IAeXMLBridge` };
}

/** Extracts operation names from a WSDL document. */
export function parseWsdlOperations(wsdl: string): string[] {
  const names = new Set<string>();
  const re = /<(?:\w+:)?operation\b[^>]*\bname="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wsdl))) names.add(m[1]);
  return [...names].sort();
}

function xmlEscape(s: string) {
  return s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
}

export type SoapParam = string | number | { enum: string; type: string };

/** RPC/encoded request envelope, as described by the WSDL binding. */
export function buildSoapEnvelope(method: string, params: Record<string, SoapParam> = {}) {
  const args = Object.entries(params)
    .map(([k, v]) => {
      if (typeof v === "object") return `<${k} xsi:type="types:${v.type}">${xmlEscape(v.enum)}</${k}>`;
      const t = typeof v === "number" ? "xsd:int" : "xsd:string";
      return `<${k} xsi:type="${t}">${xmlEscape(String(v))}</${k}>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:types="${TYPES_NS}" soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<soap:Body><ns:${method} xmlns:ns="${METHOD_NS}">${args}</ns:${method}></soap:Body></soap:Envelope>`
  );
}

type Node = Record<string, unknown>;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (name) => name === "item" });

const text = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return String((v as Node)["#text"] ?? "");
  return String(v);
};

/** A SOAP fault, in plain English. */
export class AodSoapFault extends Error {
  constructor(public faultString: string) {
    super(`Attendance on Demand refused the request: ${faultString}`);
  }
}

/**
 * Reads the `return` value of an RPC/encoded response. Handles both styles a
 * SOAP server may use: values inline, or arrays of `<item href="#n"/>` that
 * point at separate `multiRef`-style elements carrying `id="n"`.
 */
export function parseSoapReturn(xml: string): unknown {
  const doc = parser.parse(xml) as Node;
  const env = (doc.Envelope ?? doc) as Node;
  const body = (env.Body ?? {}) as Node;
  if (body.Fault) {
    const f = body.Fault as Node;
    throw new AodSoapFault(text(f.faultstring) || text(f.detail) || "unknown fault");
  }
  // Index every element that carries an id="..." (anywhere in the body).
  const byId = new Map<string, Node>();
  const index = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(index);
    if (!n || typeof n !== "object") return;
    const o = n as Node;
    if (typeof o["@_id"] === "string") byId.set(o["@_id"] as string, o);
    for (const [k, v] of Object.entries(o)) if (!k.startsWith("@_")) index(v);
  };
  index(body);
  const resolve = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(resolve);
    if (!n || typeof n !== "object") return n;
    const o = n as Node;
    const href = o["@_href"];
    if (typeof href === "string") return resolve(byId.get(href.replace(/^#/, "")) ?? {});
    if ("item" in o) return (o.item as unknown[]).map(resolve);
    const out: Node = {};
    for (const [k, v] of Object.entries(o)) if (!k.startsWith("@_")) out[k] = k === "#text" ? v : resolve(v);
    if (Object.keys(out).length === 1 && "#text" in out) return out["#text"];
    return out;
  };
  const response = Object.entries(body).find(([k]) => k.endsWith("Response"))?.[1] as Node | undefined;
  if (!response) throw new Error("Attendance on Demand sent an unexpected response.");
  const ret = response.return;
  if (ret === undefined || ret === "") return [];
  return resolve(ret);
}

const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v && typeof v === "object" ? [v as Node] : []);

export function mapAodEmployee(r: Node): AodEmployee {
  const badge = text(r.Badge);
  return {
    aodId: text(r.Filekey),
    employeeNumber: text(r.EmpID) || undefined,
    badgeNumber: badge && badge !== "0" ? badge : undefined,
    firstName: text(r.FirstName),
    lastName: text(r.LastName),
    active: text(r.ActiveStatus) === "0",
    homeFacility: text(r.WGDescr) || undefined,
    isMock: false,
  };
}

/** "yyyy-mm-dd HH:mm:ss:fff" (AOD local time) -> exact instant. */
export function aodTimestamp(ts: string, timeZone: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(ts.trim());
  if (!m) return null;
  const base = zonedToUtc(m[1], `${m[2]}:${m[3]}`, timeZone);
  return new Date(base.getTime() + Number(m[4] ?? 0) * 1000);
}

/**
 * Turns raw punches into worked segments (in -> out) per employee.
 * Explicit In (3) / Out (4) and the start/end-of-shift flags win; a plain
 * punch (0, 1) alternates in/out; transfers, access and unknown types don't
 * open or close a segment. An unmatched In becomes a segment without an out
 * time (shown as a missing punch); an unmatched Out is dropped.
 */
export function pairTransactions(rows: Node[], timeZone: string): AttendanceRecord[] {
  type P = { key: string; filekey: string; at: Date; raw: string; facility?: string; kind: "in" | "out" | "toggle" | "ignore" };
  const punches: P[] = [];
  for (const r of rows) {
    const at = aodTimestamp(text(r.TimeStamp), timeZone);
    if (!at) continue;
    const t = Number(text(r.TransType) || "0");
    const base = t & 255;
    const kind: P["kind"] = t & 256 || base === 3 ? "in" : t & 512 || base === 4 ? "out" : base === 0 || base === 1 || base === 99 ? "toggle" : "ignore";
    punches.push({ key: text(r.EmpID) || text(r.Filekey), filekey: text(r.Filekey), at, raw: text(r.TimeStamp), facility: text(r.WGDescr) || undefined, kind });
  }
  const byEmp = new Map<string, P[]>();
  for (const p of punches) if (p.kind !== "ignore") byEmp.set(p.filekey || p.key, [...(byEmp.get(p.filekey || p.key) ?? []), p]);
  const out: AttendanceRecord[] = [];
  const seg = (a: P, b?: P): AttendanceRecord => ({
    id: crypto.createHash("sha256").update(`aod|${a.filekey}|${a.raw}`).digest("hex").slice(0, 24),
    aodEmployeeKey: a.key,
    facility: a.facility,
    workDate: a.raw.slice(0, 10),
    punchIn: a.at.toISOString(),
    punchOut: b?.at.toISOString(),
    hours: b ? Math.round(((b.at.getTime() - a.at.getTime()) / 3_600_000) * 100) / 100 : undefined,
    isMock: false,
  });
  for (const list of byEmp.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let open: P | null = null;
    for (const p of list) {
      const isIn = p.kind === "in" || (p.kind === "toggle" && !open);
      if (isIn) {
        if (open) out.push(seg(open)); // previous In never closed
        open = p;
      } else if (open) {
        // Guard against nonsense (e.g. a 3-day "shift" from a forgotten punch).
        if (p.at.getTime() - open.at.getTime() <= 24 * 3_600_000) out.push(seg(open, p));
        else out.push(seg(open));
        open = null;
      }
    }
    if (open) out.push(seg(open));
  }
  return out.sort((a, b) => (a.punchIn ?? "").localeCompare(b.punchIn ?? ""));
}

/** Picks the HyperQuery covering all employees, unless AOD_HYPERQUERY names one. */
export function chooseHyperQuery(names: string[], configured?: string): string | null {
  if (configured) return names.find((n) => n.toLowerCase() === configured.toLowerCase()) ?? null;
  const lower = names.map((n) => n.toLowerCase().trim());
  for (const want of ["all employees", "all active employees", "all"]) {
    const i = lower.indexOf(want);
    if (i >= 0) return names[i];
  }
  const i = lower.findIndex((n) => n.startsWith("all ") && n.includes("employee"));
  return i >= 0 ? names[i] : null;
}

export class AodSoapClient implements AodSource {
  readonly label: string;
  readonly isDemo = false;
  constructor(
    private c: AodConfig = getAodConfig(),
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.label = `Attendance on Demand web services (${c.environment === "production" ? "PRODUCTION" : "test"} database)`;
  }

  async fetchWsdl(): Promise<string> {
    const res = await fetchWithRetry(aodUrls(this.c).wsdl, {}, { retries: 2, fetchImpl: this.fetchImpl });
    if (!res.ok) throw new IntegrationHttpError(res.status, explainHttpStatus("Attendance on Demand", res.status));
    return res.text();
  }

  /** One read-only SOAP call. Refuses any method not on the read-only list. */
  async call(method: string, params: Record<string, SoapParam> = {}): Promise<unknown> {
    if (!READ_ONLY_METHODS.has(method)) throw new Error(`Refusing to call ${method}: this integration only reads from Attendance on Demand.`);
    if (!this.c.accessAccount || !this.c.accessPassword) throw new Error("AOD access account and password must be set (AOD_ACCESS_ACCOUNT, AOD_ACCESS_PASSWORD).");
    const auth = Buffer.from(`${this.c.accessAccount}:${this.c.accessPassword}`).toString("base64");
    const res = await fetchWithRetry(
      aodUrls(this.c).soap,
      { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${METHOD_NS}#${method}"`, Authorization: `Basic ${auth}` }, body: buildSoapEnvelope(method, params) },
      { retries: 2, fetchImpl: this.fetchImpl },
    );
    const body = await res.text();
    if (res.status === 401 || res.status === 403) throw new IntegrationHttpError(res.status, "Attendance on Demand did not accept the access account or password. Check AOD_ACCESS_ACCOUNT / AOD_ACCESS_PASSWORD (the password was recently changed).", redact(body));
    // SOAP faults come back as HTTP 500 with a <Fault> body: report the fault text.
    if (!res.ok && !/Fault>/.test(body)) throw new IntegrationHttpError(res.status, explainHttpStatus("Attendance on Demand", res.status), redact(body));
    return parseSoapReturn(body);
  }

  async hyperQueryNames(): Promise<string[]> {
    return asArray(await this.call("getHyperQueriesSimple")).map((x) => text(x)).filter(Boolean) as string[];
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const ops = parseWsdlOperations(await this.fetchWsdl());
      if (!this.c.accessAccount || !this.c.accessPassword) {
        return { ok: false, message: `Reached your AOD address (${ops.length} web-service methods). Add the access account and password in secure settings to check sign-in.` };
      }
      const company = text(await this.call("getCompanyName"));
      const active = Number(text(await this.call("getActiveEmployeesCount")) || 0);
      const queries = await this.hyperQueryNames();
      const chosen = chooseHyperQuery(queries, this.c.hyperQuery);
      return {
        ok: !!chosen,
        message: chosen
          ? `Success! Signed in to Attendance on Demand for "${company}" (${active} active employees). Punches will be read using the employee list "${chosen}".`
          : `Signed in to Attendance on Demand for "${company}", but couldn't tell which saved employee list covers everyone. Set AOD_HYPERQUERY to one of: ${queries.join(", ")}.`,
        details: { company, activeEmployees: active, hyperQueries: queries, hyperQueryUsed: chosen, methods: ops.length },
      };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      if (err.cause?.code === "ENOTFOUND") return { ok: false, message: `The address ${this.c.hostname} could not be found. Check AOD_HOSTNAME.` };
      return { ok: false, message: e instanceof IntegrationHttpError ? e.plainEnglish : err.message };
    }
  }

  async fetchEmployees(): Promise<AodEmployee[]> {
    return asArray(await this.call("getAllEmployeesList")).map(mapAodEmployee);
  }

  /** Worked segments between two dates (AOD returns only the current and previous pay periods). */
  async fetchAttendance(from: Date, to: Date): Promise<AttendanceRecord[]> {
    const queries = await this.hyperQueryNames();
    const q = chooseHyperQuery(queries, this.c.hyperQuery);
    if (!q) throw new Error(`Set AOD_HYPERQUERY to the AOD saved list that includes every employee. Available: ${queries.join(", ") || "(none)"}.`);
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: this.c.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const rows = asArray(await this.call("extractRangedTransactionsUsingHyperQuery", { HyperQueryName: q, DateRangeEnum: { enum: "drCustom", type: "TDateRangeEnum" }, MinDate: day(from), MaxDate: day(to) }));
    return pairTransactions(rows, this.c.timeZone);
  }
}
