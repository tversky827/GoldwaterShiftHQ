/**
 * DEMONSTRATION Attendance on Demand feed: fictional punches for the last
 * week, generated for the given demo employees. Includes deliberate problem
 * cases (unknown employee, missing punch-out, very long shift).
 */
import type { AodEmployee, AodSource, AttendanceRecord, ConnectionTestResult } from "./types";

export interface DemoRosterEntry {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  location: string;
  active: boolean;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DemoAodSource implements AodSource {
  readonly label = "Attendance on Demand (demonstration data)";
  readonly isDemo = true;
  constructor(
    private roster: DemoRosterEntry[],
    private now = new Date(),
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Demonstration mode: no real Attendance on Demand connection is being made. Fictional punches are used." };
  }

  async fetchEmployees(): Promise<AodEmployee[]> {
    return [
      ...this.roster.map((r) => ({ aodId: `DEMO-A${r.employeeNumber}`, employeeNumber: r.employeeNumber, firstName: r.firstName, lastName: r.lastName, active: true, homeFacility: r.location, isMock: true })),
      { aodId: "DEMO-A77777", employeeNumber: "77777", firstName: "Unknown", lastName: "Person", active: true, homeFacility: this.roster[0]?.location, isMock: true },
    ];
  }

  async fetchAttendance(): Promise<AttendanceRecord[]> {
    const rnd = mulberry32(42);
    const out: AttendanceRecord[] = [];
    const starts = [7, 15, 23];
    for (let d = 7; d >= 1; d--) {
      const day = new Date(this.now);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - d);
      const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      for (const r of this.roster) {
        if (rnd() > 0.55) continue;
        const startH = starts[Math.floor(rnd() * 3)];
        const inAt = new Date(day);
        inAt.setHours(startH, Math.floor(rnd() * 10) - 5 < 0 ? 0 : Math.floor(rnd() * 6), 0, 0);
        const outAt = new Date(inAt.getTime() + (8 + (rnd() - 0.5) * 0.4) * 3_600_000);
        out.push({
          id: `DEMO-${r.employeeNumber}-${ymd}-${startH}`,
          aodEmployeeKey: r.employeeNumber,
          facility: r.location,
          workDate: ymd,
          punchIn: inAt.toISOString(),
          punchOut: outAt.toISOString(),
          hours: Math.round(((outAt.getTime() - inAt.getTime()) / 3_600_000) * 100) / 100,
          approved: d > 2,
          isMock: true,
        });
      }
    }
    if (out.length > 3) {
      delete out[1].punchOut; // missing punch out
      out[1].hours = undefined;
      out[2].punchOut = new Date(Date.parse(out[2].punchIn!) + 17 * 3_600_000).toISOString(); // long shift
      out[2].hours = 17;
    }
    const y = new Date(this.now.getTime() - 86_400_000);
    out.push({ id: "DEMO-77777-unknown", aodEmployeeKey: "77777", facility: this.roster[0]?.location, workDate: y.toISOString().slice(0, 10), punchIn: new Date(y.setHours(7, 0, 0, 0)).toISOString(), punchOut: new Date(y.setHours(15, 0, 0, 0)).toISOString(), hours: 8, isMock: true });
    return out;
  }
}
