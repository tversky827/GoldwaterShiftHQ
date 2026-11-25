/**
 * DEMONSTRATION configuration. Fictional facilities used only to populate a
 * development/demo database (rows are flagged is_demo). The application never
 * hard-codes facilities: real facilities are created in Facilities → Add facility.
 */
export const DEMO_ORG = { name: "Goldwater Care (Demonstration)", timezone: "America/New_York" };

export interface DemoFacility {
  code: string;
  name: string;
  city: string;
  state: string;
  postalCode: string;
  timezone: string;
  beds: number;
  /** The work-location string the demo Paycor feed uses for this facility. */
  paycorLocation: string;
  memoryCare?: boolean;
}

export const DEMO_FACILITIES: DemoFacility[] = [
  { code: "MGR", name: "Maple Grove Health & Rehabilitation", city: "Dayton", state: "OH", postalCode: "45402", timezone: "America/New_York", beds: 120, paycorLocation: "Maple Grove - Dayton", memoryCare: true },
  { code: "CRK", name: "Cedar Ridge Care Center", city: "Columbus", state: "OH", postalCode: "43215", timezone: "America/New_York", beds: 96, paycorLocation: "Cedar Ridge - Columbus" },
  { code: "OKH", name: "Oak Hollow Skilled Nursing", city: "Cincinnati", state: "OH", postalCode: "45202", timezone: "America/New_York", beds: 110, paycorLocation: "Oak Hollow - Cincinnati" },
  { code: "WLW", name: "Willow Bend Nursing & Rehab", city: "Toledo", state: "OH", postalCode: "43604", timezone: "America/New_York", beds: 88, paycorLocation: "Willow Bend - Toledo" },
  { code: "BRC", name: "Birchwood Care & Rehabilitation", city: "Akron", state: "OH", postalCode: "44308", timezone: "America/New_York", beds: 130, paycorLocation: "Birchwood - Akron", memoryCare: true },
  { code: "SPV", name: "Spring Valley Health Center", city: "Fort Wayne", state: "IN", postalCode: "46802", timezone: "America/Indiana/Indianapolis", beds: 100, paycorLocation: "Spring Valley - Fort Wayne" },
  { code: "LKS", name: "Lakeside Skilled Care", city: "Indianapolis", state: "IN", postalCode: "46204", timezone: "America/Indiana/Indianapolis", beds: 140, paycorLocation: "Lakeside - Indianapolis", memoryCare: true },
  { code: "PNH", name: "Pine Haven Rehabilitation", city: "Louisville", state: "KY", postalCode: "40202", timezone: "America/Kentucky/Louisville", beds: 92, paycorLocation: "Pine Haven - Louisville" },
  { code: "RVS", name: "Riverside Nursing Center", city: "Lexington", state: "KY", postalCode: "40507", timezone: "America/New_York", beds: 104, paycorLocation: "Riverside - Lexington" },
  { code: "MDW", name: "Meadowbrook Care Center", city: "Evansville", state: "IN", postalCode: "47708", timezone: "America/Chicago", beds: 84, paycorLocation: "Meadowbrook - Evansville" },
  { code: "SUM", name: "Summit View Health & Rehab", city: "Youngstown", state: "OH", postalCode: "44503", timezone: "America/New_York", beds: 116, paycorLocation: "Summit View - Youngstown" },
];

export const DEMO_POOL_LOCATION = "Regional Staffing Pool";

export const DEMO_POSITIONS = [
  { code: "RN", name: "Registered Nurse", isClinical: true, paycorTitle: "Registered Nurse" },
  { code: "LPN", name: "Licensed Practical Nurse", isClinical: true, paycorTitle: "Licensed Practical Nurse" },
  { code: "CNA", name: "Certified Nursing Assistant", isClinical: true, paycorTitle: "Certified Nursing Assistant" },
  { code: "CMA", name: "Certified Medication Aide", isClinical: true, paycorTitle: "Certified Medication Aide" },
  { code: "DA", name: "Dietary Aide", isClinical: false, paycorTitle: "Dietary Aide" },
  { code: "COOK", name: "Cook", isClinical: false, paycorTitle: "Cook" },
  { code: "HSK", name: "Housekeeper", isClinical: false, paycorTitle: "Housekeeping Aide" },
];

export const DEMO_CREDENTIAL_TYPES = [
  { code: "RN_LICENSE", name: "RN License", positions: ["RN"] },
  { code: "LPN_LICENSE", name: "LPN License", positions: ["LPN"] },
  { code: "CNA_CERT", name: "CNA Certification", positions: ["CNA", "CMA"] },
  { code: "CMA_CERT", name: "Medication Aide Certification", positions: ["CMA"] },
  { code: "CPR_BLS", name: "CPR / BLS", positions: ["RN", "LPN", "CNA", "CMA"] },
  { code: "SERVSAFE", name: "ServSafe Food Handler", positions: ["DA", "COOK"] },
];

export const DEMO_DEPARTMENTS = [
  { name: "Nursing", code: "NUR", isClinical: true, paycorName: "Nursing" },
  { name: "Dietary", code: "DIET", isClinical: false, paycorName: "Dietary" },
  { name: "Housekeeping", code: "HSK", isClinical: false, paycorName: "Environmental Services" },
];

export const DEMO_SHIFT_TEMPLATES = [
  { code: "DAY", name: "Day", startTime: "07:00", endTime: "15:00", unpaidBreakMinutes: 0 },
  { code: "EVE", name: "Evening", startTime: "15:00", endTime: "23:00", unpaidBreakMinutes: 0 },
  { code: "NOC", name: "Night", startTime: "23:00", endTime: "07:00", unpaidBreakMinutes: 0 },
];

/** Example budget matrix from the product brief. Configurable per facility/day. */
export const DEMO_BUDGET: Record<string, Record<string, number>> = {
  DAY: { RN: 1, LPN: 2, CNA: 5 },
  EVE: { RN: 1, LPN: 2, CNA: 4 },
  NOC: { RN: 1, LPN: 1, CNA: 3 },
};

/** Per-facility demo headcount by position. */
export const DEMO_HEADCOUNT: Record<string, number> = { RN: 5, LPN: 8, CNA: 16, CMA: 1, DA: 3, COOK: 2, HSK: 3 };
export const DEMO_POOL_HEADCOUNT: Record<string, number> = { RN: 3, LPN: 4, CNA: 7 };
