CREATE TABLE "marketplace_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"auto_publish_hours_before" integer DEFAULT 72 NOT NULL,
	"expiry_hours_before" integer DEFAULT 2 NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"escalation_minutes" integer[] DEFAULT '{30,60}'::integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "marketplace_settings_scope_uq" UNIQUE NULLS NOT DISTINCT("organization_id","facility_id"),
	CONSTRAINT "marketplace_settings_hours_ck" CHECK ("marketplace_settings"."auto_publish_hours_before" between 1 and 720 and "marketplace_settings"."expiry_hours_before" between 0 and 72)
);
--> statement-breakpoint
ALTER TABLE "callouts" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "callouts" ADD COLUMN "facility_id" uuid;--> statement-breakpoint
ALTER TABLE "callouts" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "callouts" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD COLUMN "requester_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD COLUMN "peer_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketplace_settings" ADD CONSTRAINT "marketplace_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_settings" ADD CONSTRAINT "marketplace_settings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_employee_id_employees_id_fk" FOREIGN KEY ("requester_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "callouts_status_idx" ON "callouts" USING btree ("status","facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "callouts_assignment_uq" ON "callouts" USING btree ("assignment_id");