/**
 * Integration data ownership matrix (system of record for each data element).
 * Sync code calls `assertCanWrite()` before writing; a violation throws, so
 * one system can never overwrite data owned by another.
 * See docs/integrations/06-data-ownership-matrix.md.
 */
export type SystemOfRecord = "paycor" | "aod" | "snf_workforce";

export interface OwnershipRule {
  data: string;
  owner: SystemOfRecord;
  fields: string[];
  verified: boolean;
  note?: string;
}

export const OWNERSHIP_MATRIX: OwnershipRule[] = [
  { data: "Employee identity", owner: "paycor", fields: ["paycorEmployeeId", "paycorLegalEntityId", "employeeNumber", "badgeNumber", "firstName", "lastName", "preferredName", "email", "mobilePhone"], verified: false },
  { data: "Employment status", owner: "paycor", fields: ["employmentStatus", "employmentType", "paycorEmploymentClass"], verified: false },
  { data: "Hire/termination status", owner: "paycor", fields: ["hireDate", "terminationDate"], verified: false },
  { data: "Job classification", owner: "paycor", fields: ["paycorPosition"], verified: false, note: "Subject to verification. Mapped to platform positions via integration mappings." },
  { data: "Home facility", owner: "paycor", fields: ["homeFacilityId", "homeDepartmentId", "paycorLocation", "paycorDepartment"], verified: false, note: "Paycor work location/department mapped to facilities by an approved mapping." },
  { data: "Regional pool classification", owner: "snf_workforce", fields: ["isRegionalPool"], verified: true, note: "Set by authorized administrators; linked to the Paycor employee." },
  { data: "Budgeted staffing", owner: "snf_workforce", fields: [], verified: true },
  { data: "Employee schedules", owner: "snf_workforce", fields: [], verified: true },
  { data: "Open shift marketplace", owner: "snf_workforce", fields: [], verified: true },
  { data: "Shift claims", owner: "snf_workforce", fields: [], verified: true },
  { data: "Clock punches", owner: "aod", fields: ["punchIn", "punchOut"], verified: false },
  { data: "Actual hours worked", owner: "aod", fields: ["hours", "approved"], verified: false, note: "Subject to verification: confirm whether approved hours are final in AOD or adjusted in Paycor payroll." },
  { data: "Pay rates", owner: "paycor", fields: ["hourlyRate", "payType"], verified: false, note: "Imported with owner approval (A1). Visible only with pay.view." },
  { data: "Payroll calculations", owner: "paycor", fields: [], verified: false, note: "Read-only. This app never submits payroll adjustments." },
  { data: "Overtime projections", owner: "snf_workforce", fields: [], verified: true },
];

const fieldOwner = new Map<string, SystemOfRecord>();
for (const rule of OWNERSHIP_MATRIX) for (const f of rule.fields) fieldOwner.set(f, rule.owner);

export class OwnershipViolation extends Error {}

export function assertCanWrite(writer: SystemOfRecord, fields: string[]): void {
  const blocked = fields.filter((f) => {
    const owner = fieldOwner.get(f);
    return owner !== undefined && owner !== writer;
  });
  if (blocked.length) {
    throw new OwnershipViolation(`${writer} attempted to write field(s) owned by another system: ${blocked.map((f) => `${f} (owner: ${fieldOwner.get(f)})`).join(", ")}`);
  }
}

export function ownerOf(field: string): SystemOfRecord | undefined {
  return fieldOwner.get(field);
}
