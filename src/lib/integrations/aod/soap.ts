/**
 * Attendance on Demand Web Services (Client Contract 1, "CC1") - SOAP.
 *
 * What AOD's public web-services documentation states (attendanceondemand.com/webservices):
 *   - CC1 is SOAP with a WSDL description.
 *   - The WSDL can be read without credentials; method calls need a valid
 *     AOD "Access Account" + password via HTTP Basic Authentication.
 *   - HTTPS only, on port 8192.
 *   - Your company is identified by the sub-domain (host name) of the URL.
 *   - WSDL path:      /cc1.aew/wsdl/IAeXMLBridge
 *   - SOAP endpoint:  /cc1exec.aew/soap/IAeXMLBridge
 *   - Use a development / test database for testing.
 *
 * NOT yet confirmed: the exact method names and parameters for extracting
 * punches/hours and employee lists for THIS account. Rather than guess, the
 * connection test downloads the WSDL and lists the methods actually offered,
 * and sync stays disabled until those methods are confirmed with AOD.
 */
import { getAodConfig, type AodConfig } from "../../config";
import { explainHttpStatus, IntegrationHttpError, redact } from "../http";
import type { AodSource, ConnectionTestResult } from "../types";

export function aodUrls(c: AodConfig) {
  if (!c.hostname) throw new Error("AOD_HOSTNAME is not set.");
  const root = `https://${c.hostname}:${c.port}`;
  return {
    wsdl: `${root}/cc1.aew/wsdl/IAeXMLBridge`,
    soap: `${root}/cc1exec.aew/soap/IAeXMLBridge`,
  };
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

export function buildSoapEnvelope(method: string, params: Record<string, string | number>, ns = "urn:AeXMLBridgeIntf-IAeXMLBridge") {
  const args = Object.entries(params)
    .map(([k, v]) => `<${k}>${xmlEscape(String(v))}</${k}>`)
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns:${method} xmlns:ns="${ns}">${args}</ns:${method}></soap:Body></soap:Envelope>`;
}

export class AodSoapClient implements AodSource {
  readonly label: string;
  constructor(private c: AodConfig = getAodConfig()) {
    this.label = `Attendance on Demand web services (${c.environment === "production" ? "PRODUCTION" : "test"} database)`;
  }

  async fetchWsdl(): Promise<string> {
    const res = await fetch(aodUrls(this.c).wsdl);
    if (!res.ok) throw new IntegrationHttpError(res.status, explainHttpStatus("Attendance on Demand", res.status));
    return res.text();
  }

  /** Low-level SOAP call. Only used once method names are confirmed. */
  async call(method: string, params: Record<string, string | number>): Promise<string> {
    if (!this.c.accessAccount || !this.c.accessPassword) throw new Error("AOD access account and password must be set.");
    const auth = Buffer.from(`${this.c.accessAccount}:${this.c.accessPassword}`).toString("base64");
    const res = await fetch(aodUrls(this.c).soap, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: method, Authorization: `Basic ${auth}` },
      body: buildSoapEnvelope(method, params),
    });
    const text = await res.text();
    if (!res.ok) throw new IntegrationHttpError(res.status, explainHttpStatus("Attendance on Demand", res.status), redact(text));
    return text;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const ops = parseWsdlOperations(await this.fetchWsdl());
      const interesting = ops.filter((o) => /punch|employee|extract|hours|transaction|schedule/i.test(o));
      return {
        ok: true,
        message:
          "Reached your Attendance on Demand web-services address and read its method list. Credentials are checked on the first data call, which is enabled once AOD confirms which methods to use.",
        details: { totalMethods: ops.length, relevantMethods: interesting },
      };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      if (err.cause?.code === "ENOTFOUND") {
        return { ok: false, message: `The address ${this.c.hostname} could not be found. Check AOD_HOSTNAME - it should be the host from your AOD login page.` };
      }
      return { ok: false, message: e instanceof IntegrationHttpError ? e.plainEnglish : err.message };
    }
  }

  async fetchEmployees(): Promise<never> {
    throw new Error(
      "AOD employee extraction is not enabled yet: waiting for Attendance on Demand to confirm the web-service method for this account. Use AOD_MODE=file with a scheduled export in the meantime.",
    );
  }
  async fetchAttendance(): Promise<never> {
    throw new Error(
      "AOD punch extraction is not enabled yet: waiting for Attendance on Demand to confirm the web-service method for this account. Use AOD_MODE=file with a scheduled export in the meantime.",
    );
  }
}
