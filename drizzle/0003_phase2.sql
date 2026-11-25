ALTER TABLE "approval_requests" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "employee_pay_rates" ADD COLUMN "pay_type" text DEFAULT 'hourly' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_pay_rates" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "employee_pay_rates" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_pay_rates_current_uq" ON "employee_pay_rates" USING btree ("employee_id") WHERE "employee_pay_rates"."effective_to" is null;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_facility_dept_period_uq" UNIQUE NULLS NOT DISTINCT("facility_id","department_id","period_start");