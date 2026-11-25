import fs from "node:fs";
import path from "node:path";
import type {
  AttendanceRecord,
  Employee,
  IntegrationState,
  PaycorTokenRecord,
  ScheduledShift,
  SyncError,
} from "./types";

/**
 * Simple JSON-file store for the integration layer.
 *
 * This keeps the integration work independent of the final database choice.
 * Swap this module for Postgres/Prisma when the core platform's database is
 * chosen; the rest of the integration code only uses the functions below.
 * The /data folder is git-ignored because it contains employee PII.
 */
export interface DbShape {
  employees: Employee[];
  attendance: AttendanceRecord[];
  schedules: ScheduledShift[];
  aodEmployees: import("./types").AodEmployee[];
  integrationState: Record<"paycor" | "aod", IntegrationState>;
  syncErrors: SyncError[];
  paycorTokens: PaycorTokenRecord[];
  oauthStates: { state: string; createdAt: string }[];
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "integration-db.json");

function empty(): DbShape {
  return {
    employees: [],
    attendance: [],
    schedules: [],
    aodEmployees: [],
    integrationState: {
      paycor: { system: "paycor", status: "never" },
      aod: { system: "aod", status: "never" },
    },
    syncErrors: [],
    paycorTokens: [],
    oauthStates: [],
  };
}

let memory: DbShape | null = null;

export function readDb(): DbShape {
  if (memory) return memory;
  try {
    memory = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch {
    memory = empty();
  }
  return memory!;
}

export function writeDb(mutator: (db: DbShape) => void): DbShape {
  const db = readDb();
  mutator(db);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
  return db;
}

/** Test helper. */
export function resetDbForTests(initial?: Partial<DbShape>) {
  memory = { ...empty(), ...initial };
}
