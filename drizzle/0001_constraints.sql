-- Hand-written integrity guarantees that the ORM cannot express.
-- These are the database's last line of defense: even buggy application code
-- cannot overfill a shift, double-book an employee, assign an inactive
-- employee, or alter the audit trail.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- 1. An employee can never hold two overlapping active assignments (any facility).
ALTER TABLE shift_assignments
  ADD CONSTRAINT assignments_no_overlap_excl
  EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status = 'assigned');
--> statement-breakpoint

-- 2. Assignments copy their time window/facility from the shift, are only
--    allowed for active shifts and active employees, and can never exceed
--    the shift's required_count. The shift row is locked, so concurrent
--    claims for the last opening serialize: exactly one wins.
CREATE OR REPLACE FUNCTION enforce_assignment_integrity() RETURNS trigger AS $$
DECLARE
  s RECORD;
  emp_status employment_status;
  filled integer;
BEGIN
  IF NEW.status <> 'assigned' THEN
    RETURN NEW;
  END IF;
  -- Only re-check when the row becomes/changes as an active assignment.
  IF TG_OP = 'UPDATE' AND OLD.status = 'assigned' AND OLD.shift_id = NEW.shift_id AND OLD.employee_id = NEW.employee_id THEN
    RETURN NEW;
  END IF;

  SELECT id, starts_at, ends_at, facility_id, required_count, status
    INTO s FROM shifts WHERE id = NEW.shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF s.status <> 'active' THEN
    RAISE EXCEPTION 'SHIFT_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT employment_status INTO emp_status FROM employees WHERE id = NEW.employee_id;
  IF emp_status IN ('inactive', 'terminated') THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  NEW.starts_at := s.starts_at;
  NEW.ends_at := s.ends_at;
  NEW.facility_id := s.facility_id;

  SELECT count(*) INTO filled FROM shift_assignments
   WHERE shift_id = NEW.shift_id AND status = 'assigned' AND id <> NEW.id;
  IF filled >= s.required_count THEN
    RAISE EXCEPTION 'SHIFT_FULL' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER shift_assignments_integrity
  BEFORE INSERT OR UPDATE ON shift_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_assignment_integrity();
--> statement-breakpoint

-- 3. Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint

-- 4. Employees and assignments are never hard-deleted (history must be preserved).
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DELETE_FORBIDDEN on %: change status instead', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER employees_no_delete BEFORE DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint

CREATE TRIGGER shift_assignments_no_delete BEFORE DELETE ON shift_assignments
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint

-- 5. Keep updated_at current on every table that has it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   r.table_name || '_set_updated_at', r.table_name);
  END LOOP;
END $$;
