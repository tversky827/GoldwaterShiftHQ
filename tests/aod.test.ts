import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/integrations/aod/csv";
import { parseAodExport } from "@/lib/integrations/aod/file";
import { buildSoapEnvelope, parseWsdlOperations } from "@/lib/integrations/aod/soap";

describe("AOD export parsing", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  });
  it("maps common headers and handles overnight shifts", () => {
    const csv = "Employee Number,First Name,Last Name,Facility,Date,In,Out,Hours\n1001,Avery,Sample,Maple Grove SNF,2026-11-23,19:00,07:00,12\n";
    const p = parseAodExport(csv);
    expect(p.attendance).toHaveLength(1);
    const r = p.attendance[0];
    expect(r.aodEmployeeKey).toBe("1001");
    expect(Date.parse(r.punchOut!) - Date.parse(r.punchIn!)).toBe(12 * 3600_000);
    expect(p.employees[0].firstName).toBe("Avery");
  });
  it("reports files without an employee column instead of guessing", () => {
    const p = parseAodExport("Name,Date\nX,2026-11-23\n");
    expect(p.attendance).toHaveLength(0);
    expect(p.problems[0]).toMatch(/no employee number/);
  });
});

describe("AOD SOAP helpers", () => {
  it("lists WSDL operations", () => {
    const wsdl = '<definitions><portType><operation name="getEmployee"/><wsdl:operation name="punchEmployeeNowByIDNum"></wsdl:operation></portType></definitions>';
    expect(parseWsdlOperations(wsdl)).toEqual(["getEmployee", "punchEmployeeNowByIDNum"]);
  });
  it("escapes values in envelopes", () => {
    expect(buildSoapEnvelope("m", { a: "<x&>" })).toContain("<a>&lt;x&amp;&gt;</a>");
  });
});
