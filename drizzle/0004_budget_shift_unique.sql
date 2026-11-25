-- Generating a schedule from a staffing budget is idempotent: one budgeted
-- shift per (schedule, budget requirement, date).
CREATE UNIQUE INDEX shifts_budget_once_uq ON shifts (schedule_id, budget_requirement_id, work_date) WHERE source = 'budget';
--> statement-breakpoint
-- Assignments for one employee in a week are looked up constantly (hours, rules).
CREATE INDEX IF NOT EXISTS timekeeping_employee_punch_idx ON timekeeping_records (employee_id, punch_in);
