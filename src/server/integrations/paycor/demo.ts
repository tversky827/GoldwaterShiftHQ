/**
 * DEMONSTRATION Paycor feed. Generates a deterministic, realistic set of fake
 * employees for the demo facilities. IDs start with "DEMO-" and every imported
 * row is flagged is_demo, so it can never be mistaken for real Paycor data.
 */
import { DEMO_FACILITIES, DEMO_HEADCOUNT, DEMO_POOL_HEADCOUNT, DEMO_POOL_LOCATION, DEMO_POSITIONS } from "@/db/seed/demo-org";
import type { ConnectionTestResult, PaycorEmployeeRecord, PaycorPayRate, PaycorSource } from "./types";

const FIRST = ["Avery", "Jordan", "Riley", "Casey", "Morgan", "Taylor", "Quinn", "Skyler", "Drew", "Jamie", "Reese", "Cameron", "Dakota", "Emerson", "Finley", "Harper", "Hayden", "Kendall", "Logan", "Marley", "Parker", "Peyton", "Rowan", "Sawyer", "Shawn", "Sidney", "Toni", "Blake", "Alexis", "Bailey", "Carmen", "Dana", "Elena", "Gabriel", "Imani", "Jada", "Keisha", "Luis", "Maria", "Nia", "Omar", "Priya", "Rosa", "Samuel", "Tanya", "Victor", "Wanda", "Yolanda", "Zoe", "Andre"];
const LAST = ["Anderson", "Brooks", "Carter", "Diaz", "Edwards", "Foster", "Garcia", "Hughes", "Irving", "Jenkins", "Kim", "Lopez", "Mitchell", "Nguyen", "Owens", "Patel", "Quinlan", "Reyes", "Sanders", "Thompson", "Underwood", "Vasquez", "Washington", "Young", "Zimmerman", "Bennett", "Coleman", "Dawson", "Ellis", "Fleming", "Graham", "Hayes", "Ingram", "Jordan", "Keller", "Lawson", "Morales", "Norris", "Ortiz", "Perry", "Ramsey", "Simmons", "Tucker", "Vaughn", "Walker", "Bishop", "Chandler", "Dixon", "Fisher", "Gibson"];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const deptFor = (code: string) => (["DA", "COOK"].includes(code) ? "Dietary" : code === "HSK" ? "Environmental Services" : "Nursing");

export function generateDemoPaycorEmployees(): PaycorEmployeeRecord[] {
  const rnd = mulberry32(20261125);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const out: PaycorEmployeeRecord[] = [];
  let n = 1000;
  const add = (location: string, code: string) => {
    n++;
    const pos = DEMO_POSITIONS.find((p) => p.code === code)!;
    const r = rnd();
    const status = r < 0.03 ? "terminated" : r < 0.05 ? "leave" : "active";
    const c = rnd();
    const employmentClass = location === DEMO_POOL_LOCATION ? (c < 0.7 ? "Full Time" : "PRN") : c < 0.62 ? "Full Time" : c < 0.82 ? "Part Time" : "PRN";
    const year = 2012 + Math.floor(rnd() * 14);
    const hire = `${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`;
    const first = pick(FIRST);
    const last = pick(LAST);
    out.push({
      paycorEmployeeId: `DEMO-${n}`,
      legalEntityId: "DEMO-LE-1",
      employeeNumber: String(n),
      firstName: first,
      lastName: last,
      email: `${first}.${last}.${n}@example.com`.toLowerCase(),
      status,
      employmentClass,
      hireDate: hire,
      terminationDate: status === "terminated" ? "2026-10-31" : undefined,
      position: pos.paycorTitle,
      department: deptFor(code),
      location,
    });
  };
  for (const f of DEMO_FACILITIES) for (const [code, count] of Object.entries(DEMO_HEADCOUNT)) for (let i = 0; i < count; i++) add(f.paycorLocation, code);
  for (const [code, count] of Object.entries(DEMO_POOL_HEADCOUNT)) for (let i = 0; i < count; i++) add(DEMO_POOL_LOCATION, code);
  // A deliberate duplicate employee number so reconciliation has something to show.
  out.push({ ...out[3], paycorEmployeeId: "DEMO-9999", firstName: out[3].firstName, lastName: `${out[3].lastName}-Duplicate` });
  // A record with an unmapped location.
  out.push({ ...out[5], paycorEmployeeId: "DEMO-9998", employeeNumber: "9998", location: "Unmapped Location (Demo)" });
  return out;
}

const DEMO_BASE_RATE: Record<string, number> = { "Registered Nurse": 41, "Licensed Practical Nurse": 29.5, "Certified Nursing Assistant": 18.75, "Certified Medication Aide": 20.5, "Dietary Aide": 15.25, Cook: 17, "Housekeeping Aide": 15 };

/** Fictional, deterministic pay rates for demonstration employees. */
export function demoPayRates(employees: PaycorEmployeeRecord[]): PaycorPayRate[] {
  return employees
    .filter((e) => e.position && DEMO_BASE_RATE[e.position])
    .map((e) => {
      const n = Number(e.employeeNumber ?? 0);
      const bump = ((n * 37) % 25) / 10; // 0–2.4
      return { paycorEmployeeId: e.paycorEmployeeId, hourlyRate: Math.round((DEMO_BASE_RATE[e.position!] + bump + (e.employmentClass === "PRN" ? 2 : 0)) * 100) / 100, payType: "hourly" as const, description: "Base rate (demonstration)", effectiveFrom: e.hireDate ?? "2026-01-01" };
    });
}

export class DemoPaycorSource implements PaycorSource {
  readonly label = "Paycor (demonstration data)";
  readonly isDemo = true;
  constructor(private records: PaycorEmployeeRecord[] = generateDemoPaycorEmployees()) {}
  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Demonstration mode: no real Paycor connection is being made. Fictional employees are used.", details: { employees: this.records.length } };
  }
  async fetchEmployees() {
    return { records: this.records.map((r) => ({ ...r })), legalEntities: ["DEMO-LE-1"] };
  }
  async fetchPayRates(employees: PaycorEmployeeRecord[]): Promise<PaycorPayRate[]> {
    return demoPayRates(employees);
  }
}
