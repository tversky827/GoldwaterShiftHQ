/**
 * Integration data ownership matrix (system of record for each data element).
 *
 * The app must never overwrite data owned by another system. Sync code calls
 * `assertCanWrite()` before writing a field; a violation throws.
 *
 * "verified" stays false until the owner confirms it against the actual
 * Paycor / AOD configuration (see docs/integrations/06-data-ownership-matrix.md).
 */
import type { SourceSystem } from "./store/types";

export interface OwnershipRule {
  data: string;
  owner: SourceSystem;
  /** Fields on our records governed by this rule. */
  fields: string[];
  verified: boolean;
  note?: string;
}

export const OWNERSHIP_MATRIX: OwnershipRule[] = [
  { data: "Employee identity", owner: "paycor", fields: ["paycorEmployeeId", "employeeNumber", "firstName", "lastName"], verified: false },
  { data: "Employment status", owner: "paycor", fields: ["status"], verified: false },
  { data: "Hire/termination status", owner: "paycor", fields: ["hireDate", "terminationDate"], verified: false },
  { data: "Job classification", owner: "paycor", fields: ["jobTitle", "department"], verified: false, note: "Subject to verification: confirm Paycor job/position data is maintained and accurate." },
  { data: "Home facility", owner: "paycor", fields: ["homeFacility"], verified: false, note: "Paycor, or an approved scheduling-platform mapping from Paycor location/department to facility." },
  { data: "Regional pool classification", owner: "snf_workforce", fields: ["regionalPool"], verified: false, note: "Stored in the scheduling platform, linked to the Paycor employee ID." },
  { data: "Budgeted staffing", owner: "snf_workforce", fields: [], verified: true },
  { data: "Employee schedules", owner: "snf_workforce", fields: [], verified: true },
  { data: "Open shift marketplace", owner: "snf_workforce", fields: [], verified: true },
  { data: "Shift claims", owner: "snf_workforce", fields: [], verified: true },
  { data: "Clock punches", owner: "aod", fields: ["punchIn", "punchOut"], verified: false },
  { data: "Actual hours worked", owner: "aod", fields: ["hours", "approved"], verified: false, note: "Subject to verification: confirm whether approved hours live in AOD or are finalized in Paycor payroll." },
  { data: "Payroll calculations", owner: "paycor", fields: [], verified: false, note: "Read-only. This app never submits payroll adjustments." },
  { data: "Overtime projections", owner: "snf_workforce", fields: [], verified: true },
];

const fieldOwner = new Map<string, SourceSystem>();
for (const rule of OWNERSHIP_MATRIX) for (const f of rule.fields) fieldOwner.set(f, rule.owner);

export class OwnershipViolation extends Error {}

/** Throws if `writer` tries to write a field owned by a different system. */
export function assertCanWrite(writer: SourceSystem, fields: string[]): void {
  const blocked = fields.filter((f) => {
    const owner = fieldOwner.get(f);
    return owner !== undefined && owner !== writer;
  });
  if (blocked.length) {
    throw new OwnershipViolation(
      `${writer} attempted to write field(s) owned by another system: ${blocked
        .map((f) => `${f} (owner: ${fieldOwner.get(f)})`)
        .join(", ")}`,
    );
  }
}

export function ownerOf(field: string): SourceSystem | undefined {
  return fieldOwner.get(field);
}
