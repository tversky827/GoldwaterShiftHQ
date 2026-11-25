import type { AodEmployee, AttendanceRecord, Employee } from "../store/types";

export interface ConnectionTestResult {
  ok: boolean;
  /** Plain-English explanation for the owner. */
  message: string;
  /** Extra technical facts that are safe to show (never secrets or PII). */
  details?: Record<string, unknown>;
}

export type PaycorEmployeeInput = Omit<Employee, "id" | "lastSyncedAt" | "regionalPool">;

export interface PaycorSource {
  readonly label: string;
  testConnection(): Promise<ConnectionTestResult>;
  fetchEmployees(): Promise<PaycorEmployeeInput[]>;
}

export interface AodSource {
  readonly label: string;
  testConnection(): Promise<ConnectionTestResult>;
  fetchEmployees(): Promise<AodEmployee[]>;
  fetchAttendance(from: Date, to: Date): Promise<Omit<AttendanceRecord, "importedAt">[]>;
}
