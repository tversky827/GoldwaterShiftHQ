import { describe, expect, it } from "vitest";
import { AodSoapClient, AodSoapFault, aodTimestamp, buildSoapEnvelope, chooseHyperQuery, mapAodEmployee, pairTransactions, parseSoapReturn } from "@/server/integrations/aod/soap";
import type { AodConfig } from "@/server/integrations/config";

const env = (inner: string) => `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
const emp = (id: number, f: Record<string, string>) =>
  `<NS2:TAeEmployeeBasic id="${id}" xsi:type="NS2:TAeEmployeeBasic">${Object.entries(f).map(([k, v]) => `<${k} xsi:type="xsd:string">${v}</${k}>`).join("")}</NS2:TAeEmployeeBasic>`;

// Delphi-style RPC/encoded: array items are references to separate elements.
const EMPLOYEES_HREF = env(
  `<NS1:getAllEmployeesListResponse xmlns:NS1="urn:AeXMLBridgeIntf-IAeXMLBridge"><return xsi:type="SOAP-ENC:Array" SOAP-ENC:arrayType="NS2:TAeEmployeeBasic[2]"><item href="#1"/><item href="#2"/></return></NS1:getAllEmployeesListResponse>` +
    emp(1, { EmpName: "Diaz, Ana", LastName: "Diaz", FirstName: "Ana", EmpID: "1042", Badge: "77", Filekey: "5001", ActiveStatus: "0", DateOfHire: "2019-04-01", WGDescr: "Maple Grove/Nursing/CNA" }) +
    emp(2, { EmpName: "Lee, Bo", LastName: "Lee", FirstName: "Bo", EmpID: "1043", Badge: "0", Filekey: "5002", ActiveStatus: "1", DateOfHire: "2018-01-01", WGDescr: "Cedar Ridge/Dietary/Cook" }),
);
// Inline style: the same data without references.
const EMPLOYEES_INLINE = env(
  `<ns:getAllEmployeesListResponse xmlns:ns="urn:AeXMLBridgeIntf-IAeXMLBridge"><return><item><EmpID>1042</EmpID><FirstName>Ana</FirstName><LastName>Diaz</LastName><Badge>77</Badge><Filekey>5001</Filekey><ActiveStatus>0</ActiveStatus><WGDescr>Maple Grove/Nursing/CNA</WGDescr></item></return></ns:getAllEmployeesListResponse>`,
);
const tx = (id: number, empId: string, filekey: string, ts: string, type: number) => emp(id, { EmpID: empId, Filekey: filekey, FirstName: "x", LastName: "y", WGDescr: "Maple Grove/Nursing/CNA", TimeStamp: ts, Station: "1", TransType: String(type) });

describe("AOD SOAP (CC1) client", () => {
  it("builds an RPC/encoded request with typed parameters", () => {
    const x = buildSoapEnvelope("extractRangedTransactionsUsingHyperQuery", { HyperQueryName: "All Employees", DateRangeEnum: { enum: "drCustom", type: "TDateRangeEnum" }, MinDate: "2026-11-01", MaxDate: "2026-11-14" });
    expect(x).toContain('<ns:extractRangedTransactionsUsingHyperQuery xmlns:ns="urn:AeXMLBridgeIntf-IAeXMLBridge">');
    expect(x).toContain('<DateRangeEnum xsi:type="types:TDateRangeEnum">drCustom</DateRangeEnum>');
    expect(x).toContain('<MinDate xsi:type="xsd:string">2026-11-01</MinDate>');
    expect(x).toContain('soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"');
  });

  it("reads arrays in both reference (href/id) and inline styles", () => {
    const a = parseSoapReturn(EMPLOYEES_HREF) as Record<string, string>[];
    expect(a.map(mapAodEmployee)).toEqual([
      { aodId: "5001", employeeNumber: "1042", badgeNumber: "77", firstName: "Ana", lastName: "Diaz", active: true, homeFacility: "Maple Grove/Nursing/CNA", isMock: false },
      { aodId: "5002", employeeNumber: "1043", badgeNumber: undefined, firstName: "Bo", lastName: "Lee", active: false, homeFacility: "Cedar Ridge/Dietary/Cook", isMock: false },
    ]);
    const b = parseSoapReturn(EMPLOYEES_INLINE) as Record<string, string>[];
    expect(mapAodEmployee(b[0])).toMatchObject({ employeeNumber: "1042", active: true });
    expect(parseSoapReturn(env(`<ns:getCompanyNameResponse xmlns:ns="x"><return xsi:type="xsd:string">Goldwater Care</return></ns:getCompanyNameResponse>`))).toBe("Goldwater Care");
  });

  it("turns a SOAP fault into a readable error", () => {
    expect(() => parseSoapReturn(env(`<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Hyper Query does not exist</faultstring></SOAP-ENV:Fault>`))).toThrow(AodSoapFault);
    expect(() => parseSoapReturn(env(`<SOAP-ENV:Fault><faultstring>Hyper Query does not exist</faultstring></SOAP-ENV:Fault>`))).toThrow(/Hyper Query does not exist/);
  });

  it("reads AOD local timestamps in the AOD time zone", () => {
    expect(aodTimestamp("2026-11-25 07:02:30:000", "America/Chicago")!.toISOString()).toBe("2026-11-25T13:02:30.000Z");
    expect(aodTimestamp("2026-07-01 07:00:00:000", "America/Chicago")!.toISOString()).toBe("2026-07-01T12:00:00.000Z"); // daylight time
    expect(aodTimestamp("garbage", "America/Chicago")).toBeNull();
  });

  it("pairs punches into worked segments", () => {
    const rows = parseSoapReturn(
      env(
        `<r:xResponse xmlns:r="x"><return><item href="#1"/><item href="#2"/><item href="#3"/><item href="#4"/><item href="#5"/><item href="#6"/><item href="#7"/></return></r:xResponse>` +
          tx(1, "1042", "5001", "2026-11-24 06:58:00:000", 3) + // explicit In
          tx(2, "1042", "5001", "2026-11-24 10:00:00:000", 2) + // transfer: ignored
          tx(3, "1042", "5001", "2026-11-24 15:04:00:000", 4) + // explicit Out
          tx(4, "1043", "5002", "2026-11-24 22:55:00:000", 0) + // plain punch -> in
          tx(5, "1043", "5002", "2026-11-25 07:05:00:000", 0) + // plain punch -> out (overnight)
          tx(6, "1044", "5003", "2026-11-25 06:59:00:000", 3 | 256) + // In, start of shift, no out yet
          tx(7, "1045", "5004", "2026-11-25 08:00:00:000", 4), // Out with no In: dropped
      ),
    ) as Record<string, string>[];
    const segs = pairTransactions(rows, "America/Chicago");
    expect(segs.map((s) => [s.aodEmployeeKey, s.workDate, s.hours ?? null])).toEqual([
      ["1042", "2026-11-24", 8.1],
      ["1043", "2026-11-24", 8.17],
      ["1044", "2026-11-25", null],
    ]);
    expect(segs[1].punchOut).toBe("2026-11-25T13:05:00.000Z");
    expect(segs[2].punchOut).toBeUndefined(); // shown as a missing punch
    expect(new Set(segs.map((s) => s.id)).size).toBe(3);
    // Stable ids: re-running the same data updates rather than duplicates.
    expect(pairTransactions(rows, "America/Chicago").map((s) => s.id)).toEqual(segs.map((s) => s.id));
  });

  it("picks the all-employees saved list, or the one configured", () => {
    expect(chooseHyperQuery(["Nursing Only", "All Active Employees", "All Employees"])).toBe("All Employees");
    expect(chooseHyperQuery(["Nursing Only", "All Active Employees"])).toBe("All Active Employees");
    expect(chooseHyperQuery(["Nursing Only", "Kitchen"])).toBeNull();
    expect(chooseHyperQuery(["Nursing Only", "Kitchen"], "kitchen")).toBe("Kitchen");
  });

  const cfg = { mode: "soap", environment: "test", hostname: "goldwater.attendanceondemand.com", port: 443, accessAccount: "acct", accessPassword: "pw", exportDir: "", timeZone: "America/Chicago" } as AodConfig;

  it("calls only read methods, over HTTPS port 443 with basic auth, and reads employees and punches", async () => {
    const calls: { url: string; action: string; body: string; auth: string }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, action: h.SOAPAction, body: String(init?.body ?? ""), auth: h.Authorization });
      const method = /#(\w+)"/.exec(h.SOAPAction)?.[1];
      if (method === "getHyperQueriesSimple") return new Response(env(`<a:getHyperQueriesSimpleResponse xmlns:a="x"><return><item>Nursing</item><item>All Employees</item></return></a:getHyperQueriesSimpleResponse>`));
      if (method === "getAllEmployeesList") return new Response(EMPLOYEES_HREF);
      if (method === "extractRangedTransactionsUsingHyperQuery") return new Response(env(`<a:xResponse xmlns:a="x"><return><item href="#1"/><item href="#2"/></return></a:xResponse>` + tx(1, "1042", "5001", "2026-11-24 07:00:00:000", 3) + tx(2, "1042", "5001", "2026-11-24 15:00:00:000", 4)));
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const c = new AodSoapClient(cfg, fake);
    expect((await c.fetchEmployees()).length).toBe(2);
    const a = await c.fetchAttendance(new Date("2026-11-20T12:00:00Z"), new Date("2026-11-25T12:00:00Z"));
    expect(a).toHaveLength(1);
    expect(a[0].hours).toBe(8);
    const ext = calls.find((x) => x.action.includes("extractRanged"))!;
    expect(ext.url).toBe("https://goldwater.attendanceondemand.com:443/cc1exec.aew/soap/IAeXMLBridge");
    expect(ext.body).toContain("<HyperQueryName xsi:type=\"xsd:string\">All Employees</HyperQueryName>");
    expect(ext.body).toContain("<MinDate xsi:type=\"xsd:string\">2026-11-20</MinDate>");
    expect(ext.auth).toBe(`Basic ${Buffer.from("acct:pw").toString("base64")}`);
    await expect(c.call("punchEmployeeNowByIDNum", { IDNum: "1" })).rejects.toThrow(/only reads/);
  });

  it("explains a rejected password in plain English", async () => {
    const c = new AodSoapClient(cfg, (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch);
    await expect(c.fetchEmployees()).rejects.toMatchObject({ plainEnglish: expect.stringMatching(/did not accept the access account or password/) });
  });
});
