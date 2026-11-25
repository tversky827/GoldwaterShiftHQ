/** Shared data model. `source` fields record which system owns each record. */

export type SourceSystem = "paycor" | "aod" | "snf_workforce";

export type EmploymentStatus = "active" | "inactive" | "terminated" | "leave" | "unknown";

/** Employee as owned by Paycor (system of record for identity & status). */
export interface Employee {
  id: string; // internal id
  paycorEmployeeId: string;
  employeeNumber?: string;
  badgeNumber?: string;
  firstName: string;
  lastName: string;
  status: EmploymentStatus;
  hireDate?: string;
  terminationDate?: string;
  jobTitle?: string;
  department?: string;
  homeFacility?: string; // Paycor location/department or approved mapping
  legalEntityId?: number;
  /** Owned by SNF Workforce, linked to Paycor employee. */
  regionalPool?: string;
  /** Mock data is always labelled so it can never be confused with real data. */
  isMock: boolean;
  lastSyncedAt: string;
}

/** AOD employee record (used only for matching - never creates Employees). */
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

/** Clock punch pair / worked segment as owned by AOD. Read-only in this app. */
export interface AttendanceRecord {
  id: string; // stable key from AOD (or file row hash)
  aodEmployeeKey: string; // the employee number/badge as AOD reports it
  facility?: string;
  workDate: string; // YYYY-MM-DD
  punchIn?: string; // ISO
  punchOut?: string; // ISO
  hours?: number;
  approved?: boolean;
  isMock: boolean;
  importedAt: string;
}

/** Scheduled shift (owned by SNF Workforce). */
export interface ScheduledShift {
  id: string;
  employeeId: string;
  facility: string;
  start: string; // ISO
  end: string; // ISO
}

export type SyncStatus = "never" | "running" | "success" | "failed";

export interface IntegrationState {
  system: "paycor" | "aod";
  lastSyncStartedAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureMessage?: string;
  status: SyncStatus;
  lastConnectionTestAt?: string;
  lastConnectionTestOk?: boolean;
  lastConnectionTestMessage?: string;
}

export interface SyncError {
  id: string;
  system: "paycor" | "aod";
  at: string;
  message: string;
  detail?: string;
  resolved: boolean;
}

export interface PaycorTokenRecord {
  legalEntityId: number | null; // null until we learn which entity it belongs to
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: string;
  mode: "sandbox" | "production";
}
