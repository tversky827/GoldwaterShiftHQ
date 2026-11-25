/**
 * MOCK Paycor data. Clearly fake ("MOCK-" ids) so it can never be mistaken
 * for real employees. Includes deliberate problem cases to exercise
 * reconciliation (missing employee number, duplicate, terminated, etc.).
 */
import type { ConnectionTestResult, PaycorEmployeeInput, PaycorSource } from "../types";

const base = { legalEntityId: 999001, isMock: true } as const;

export const MOCK_PAYCOR_EMPLOYEES: PaycorEmployeeInput[] = [
  { ...base, paycorEmployeeId: "MOCK-P1001", employeeNumber: "1001", firstName: "Avery", lastName: "Sample", status: "active", jobTitle: "CNA", department: "Nursing", homeFacility: "Maple Grove SNF", hireDate: "2021-03-01" },
  { ...base, paycorEmployeeId: "MOCK-P1002", employeeNumber: "1002", firstName: "Jordan", lastName: "Testcase", status: "active", jobTitle: "LPN", department: "Nursing", homeFacility: "Maple Grove SNF", hireDate: "2019-07-15" },
  { ...base, paycorEmployeeId: "MOCK-P1003", employeeNumber: "1003", firstName: "Riley", lastName: "Demo", status: "active", jobTitle: "RN", department: "Nursing", homeFacility: "Cedar Ridge SNF", hireDate: "2022-01-10" },
  { ...base, paycorEmployeeId: "MOCK-P1004", employeeNumber: "1004", firstName: "Casey", lastName: "Placeholder", status: "terminated", jobTitle: "CNA", department: "Nursing", homeFacility: "Cedar Ridge SNF", hireDate: "2020-05-05", terminationDate: "2026-10-31" },
  { ...base, paycorEmployeeId: "MOCK-P1005", employeeNumber: "1005", firstName: "Morgan", lastName: "Fixture", status: "active", jobTitle: "CNA", department: "Nursing", homeFacility: "Oak Hollow SNF", hireDate: "2023-09-18" },
  { ...base, paycorEmployeeId: "MOCK-P1006", employeeNumber: undefined, firstName: "Taylor", lastName: "Nonumber", status: "active", jobTitle: "Dietary Aide", department: "Dietary", homeFacility: "Oak Hollow SNF", hireDate: "2024-02-02" },
  { ...base, paycorEmployeeId: "MOCK-P1007", employeeNumber: "1007", firstName: "Quinn", lastName: "Example", status: "active", jobTitle: "RN", department: "Nursing", homeFacility: "Maple Grove SNF", hireDate: "2018-11-11" },
  { ...base, paycorEmployeeId: "MOCK-P1008", employeeNumber: "1007", firstName: "Quinn", lastName: "Example-Dup", status: "active", jobTitle: "RN", department: "Nursing", homeFacility: "Maple Grove SNF", hireDate: "2018-11-11" },
  { ...base, paycorEmployeeId: "MOCK-P1009", employeeNumber: "1009", firstName: "Skyler", lastName: "Mockford", status: "leave", jobTitle: "CNA", department: "Nursing", homeFacility: "Cedar Ridge SNF", hireDate: "2021-06-21" },
  { ...base, paycorEmployeeId: "MOCK-P1010", employeeNumber: "1010", firstName: "Drew", lastName: "Stub", status: "active", jobTitle: "CNA", department: "Nursing", homeFacility: "Oak Hollow SNF", hireDate: "2025-04-14" },
];

export class MockPaycorSource implements PaycorSource {
  readonly label = "Paycor (MOCK - fake data)";
  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Mock mode: no real Paycor connection is being made. Fake employees are used.", details: { employees: MOCK_PAYCOR_EMPLOYEES.length } };
  }
  async fetchEmployees() {
    return MOCK_PAYCOR_EMPLOYEES.map((e) => ({ ...e }));
  }
}
