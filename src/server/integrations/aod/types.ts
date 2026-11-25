import type { ConnectionTestResult } from "../paycor/types";
export type { ConnectionTestResult };

/** AOD employee (used only for matching; never creates platform employees). */
export interface AodEmployee {
  aodId: string;
  employeeNumber?: string;
  badgeNumber?: string;
  firstName: string;
  lastName: string;
  active: boolean;
  homeFacility?: string;
  isMock: boolean;
}

/** One worked segment / punch pair from AOD. Read-only in this platform. */
export interface AttendanceRecord {
  id: string;
  aodEmployeeKey: string;
  facility?: string;
  workDate: string; // YYYY-MM-DD
  punchIn?: string; // ISO
  punchOut?: string; // ISO
  hours?: number;
  approved?: boolean;
  isMock: boolean;
}

export interface AodSource {
  readonly label: string;
  readonly isDemo: boolean;
  testConnection(): Promise<ConnectionTestResult>;
  fetchEmployees(): Promise<AodEmployee[]>;
  fetchAttendance(from: Date, to: Date): Promise<AttendanceRecord[]>;
}
