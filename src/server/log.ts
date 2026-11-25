/** Structured JSON logging. Never pass secrets or full employee records here. */
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  debug: (e: string, f?: Record<string, unknown>) => emit("debug", e, f),
  info: (e: string, f?: Record<string, unknown>) => emit("info", e, f),
  warn: (e: string, f?: Record<string, unknown>) => emit("warn", e, f),
  error: (e: string, f?: Record<string, unknown>) => emit("error", e, f),
};
