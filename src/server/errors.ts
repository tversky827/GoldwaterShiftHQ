export class AppError extends Error {
  constructor(
    message: string,
    public code = "APP_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(message, "FORBIDDEN", 403);
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`, "NOT_FOUND", 404);
  }
}

/** Map Postgres errors raised by our integrity triggers/constraints to friendly messages. */
export function friendlyDbError(e: unknown): string | null {
  const err = e as { message?: string; cause?: { message?: string } };
  const msg = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  if (msg.includes("SHIFT_FULL")) return "This shift is already fully staffed.";
  if (msg.includes("EMPLOYEE_NOT_ACTIVE")) return "This employee is not active and can't be scheduled.";
  if (msg.includes("SHIFT_NOT_ACTIVE")) return "This shift has been cancelled.";
  if (msg.includes("assignments_no_overlap_excl")) return "This employee already has an overlapping shift.";
  if (msg.includes("assignments_active_uq")) return "This employee is already assigned to this shift.";
  if (msg.includes("claims_active_uq")) return "You've already requested this shift.";
  if (msg.includes("duplicate key")) return "That already exists.";
  return null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  return friendlyDbError(e) ?? "Something went wrong. Please try again.";
}
