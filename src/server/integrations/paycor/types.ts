export type PaycorStatus = "active" | "inactive" | "terminated" | "leave" | "unknown";

/** One employee as received from Paycor, normalized. All org fields are raw Paycor strings. */
export interface PaycorEmployeeRecord {
  paycorEmployeeId: string;
  legalEntityId: string;
  employeeNumber?: string;
  badgeNumber?: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  email?: string;
  mobilePhone?: string;
  status: PaycorStatus;
  employmentClass?: string; // e.g. "Full Time", "Part Time", "PRN"
  hireDate?: string;
  terminationDate?: string;
  position?: string;
  department?: string;
  location?: string;
}

/** A current pay rate. Imported with owner approval (decision A1); restricted to `pay.view`. */
export interface PaycorPayRate {
  paycorEmployeeId: string;
  hourlyRate: number;
  payType: "hourly" | "salary";
  description?: string;
  effectiveFrom: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Safe facts only: never secrets, never employee data values. */
  details?: Record<string, unknown>;
}

export interface PaycorSource {
  readonly label: string;
  readonly isDemo: boolean;
  testConnection(): Promise<ConnectionTestResult>;
  /** Must fetch EVERYTHING before returning; sync applies nothing on failure. */
  fetchEmployees(): Promise<{ records: PaycorEmployeeRecord[]; legalEntities: string[] }>;
  /** Optional: current pay rates. A failure here never blocks the employee sync. */
  fetchPayRates?(employees: PaycorEmployeeRecord[]): Promise<PaycorPayRate[]>;
}
