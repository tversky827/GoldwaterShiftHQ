CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'integration');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'cancelled', 'called_out', 'swapped_out', 'completed');--> statement-breakpoint
CREATE TYPE "public"."assignment_via" AS ENUM('scheduler', 'marketplace', 'swap', 'callout', 'auto');--> statement-breakpoint
CREATE TYPE "public"."availability_kind" AS ENUM('available', 'unavailable', 'preferred');--> statement-breakpoint
CREATE TYPE "public"."callout_status" AS ENUM('open', 'covered', 'uncovered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('pending', 'approved', 'auto_approved', 'rejected', 'cancelled', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('not_configured', 'pending_authorization', 'connected', 'needs_attention', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('pending_verification', 'verified', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('active', 'inactive', 'terminated', 'leave');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'prn', 'temporary', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."integration_environment" AS ENUM('mock', 'sandbox', 'production', 'test', 'file');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('paycor', 'aod');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('scheduled', 'open', 'filled', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'read');--> statement-breakpoint
CREATE TYPE "public"."record_source" AS ENUM('paycor', 'aod', 'manual', 'demo');--> statement-breakpoint
CREATE TYPE "public"."rule_outcome" AS ENUM('warning', 'approval_required', 'hard_block');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('max_weekly_hours', 'max_daily_hours', 'max_consecutive_days', 'min_rest_hours', 'overlapping_shifts', 'facility_authorization', 'credential_required', 'position_qualification', 'availability', 'employment_classification');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('organization', 'facility', 'department', 'pool');--> statement-breakpoint
CREATE TYPE "public"."shift_source" AS ENUM('budget', 'manual', 'callout');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."swap_status" AS ENUM('pending_peer', 'pending_manager', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('manual', 'scheduled', 'system');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'offered', 'claimed', 'removed');--> statement-breakpoint
CREATE TYPE "public"."workflow_type" AS ENUM('marketplace_claim', 'shift_swap', 'rule_override', 'callout_coverage', 'manual_assignment');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid,
	"workflow_type" "workflow_type" NOT NULL,
	"facility_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid,
	"workflow_type" "workflow_type" NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"approver_permission" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"facility_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "callouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"reported_by" uuid,
	"reason" text,
	"status" "callout_status" DEFAULT 'open' NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"listing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"requires_expiration" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_types_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_clinical" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "departments_facility_name_uq" UNIQUE("facility_id","name")
);
--> statement-breakpoint
CREATE TABLE "employee_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "availability_kind" NOT NULL,
	"day_of_week" smallint,
	"specific_date" date,
	"start_time" time,
	"end_time" time,
	"shift_template_id" uuid,
	"facility_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_when_ck" CHECK (("employee_availability"."day_of_week" is not null) <> ("employee_availability"."specific_date" is not null)),
	CONSTRAINT "availability_dow_ck" CHECK ("employee_availability"."day_of_week" is null or "employee_availability"."day_of_week" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "employee_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"credential_type_id" uuid NOT NULL,
	"identifier" text,
	"issuing_state" text,
	"issued_on" date,
	"expires_on" date,
	"status" "credential_status" DEFAULT 'pending_verification' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_facility_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"reason" text,
	"authorized_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_pay_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"source" "record_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_positions_uq" UNIQUE("employee_id","position_id")
);
--> statement-breakpoint
CREATE TABLE "employee_preferences" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"max_weekly_hours" numeric(5, 2),
	"preferred_shift_template_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferred_facility_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"paycor_employee_id" text,
	"paycor_legal_entity_id" text,
	"employee_number" text,
	"badge_number" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"email" text,
	"mobile_phone" text,
	"employment_status" "employment_status" DEFAULT 'active' NOT NULL,
	"employment_type" "employment_type" DEFAULT 'unknown' NOT NULL,
	"hire_date" date,
	"termination_date" date,
	"home_facility_id" uuid,
	"home_department_id" uuid,
	"is_regional_pool" boolean DEFAULT false NOT NULL,
	"paycor_position" text,
	"paycor_department" text,
	"paycor_location" text,
	"paycor_employment_class" text,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"source_hash" text,
	"last_synced_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"phone" text,
	"timezone" text NOT NULL,
	"licensed_beds" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "facilities_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "facility_positions" (
	"facility_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_positions_facility_id_position_id_pk" PRIMARY KEY("facility_id","position_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"environment" "integration_environment" NOT NULL,
	"legal_entity_id" text,
	"display_name" text NOT NULL,
	"status" "connection_status" DEFAULT 'not_configured' NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"authorized_by" uuid,
	"authorized_at" timestamp with time zone,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_uq" UNIQUE NULLS NOT DISTINCT("organization_id","provider","environment","legal_entity_id")
);
--> statement-breakpoint
CREATE TABLE "integration_field_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"source_type" text NOT NULL,
	"source_value" text NOT NULL,
	"facility_id" uuid,
	"department_id" uuid,
	"position_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "integration_mappings_uq" UNIQUE("organization_id","provider","source_type","source_value")
);
--> statement-breakpoint
CREATE TABLE "integration_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" "integration_provider" NOT NULL,
	"environment" "integration_environment" NOT NULL,
	"sync_type" text NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_received" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_unchanged" integer DEFAULT 0 NOT NULL,
	"records_deactivated" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"details" jsonb,
	"initiated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"openings" integer NOT NULL,
	"status" "listing_status" DEFAULT 'open' NOT NULL,
	"publish_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"incentive_text" text,
	"incentive_amount" numeric(10, 2),
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_by" uuid,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_openings_ck" CHECK ("marketplace_listings"."openings" > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_category_channel_pk" PRIMARY KEY("user_id","category","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_id" uuid,
	"channel" "notification_channel" DEFAULT 'in_app' NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overtime_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid,
	"name" text NOT NULL,
	"weekly_threshold_hours" numeric(5, 2),
	"daily_threshold_hours" numeric(5, 2),
	"warning_at_hours" numeric(5, 2),
	"workweek_start_day" smallint DEFAULT 0 NOT NULL,
	"outcome" "rule_outcome" DEFAULT 'approval_required' NOT NULL,
	"overridable" boolean DEFAULT true NOT NULL,
	"applies_to_employment_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_credential_requirements" (
	"position_id" uuid NOT NULL,
	"credential_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_credential_requirements_position_id_credential_type_id_pk" PRIMARY KEY("position_id","credential_type_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_clinical" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_org_code_uq" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"default_scope" "scope_type" DEFAULT 'facility' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_org_key_uq" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "rule_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid,
	"rule_type" "rule_type" NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"employee_id" uuid,
	"explanation" text NOT NULL,
	"overridden_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_overrides_explanation_ck" CHECK (length(trim("rule_overrides"."explanation")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"department_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "schedule_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "schedules_period_ck" CHECK ("schedules"."period_end" >= "schedules"."period_start")
);
--> statement-breakpoint
CREATE TABLE "scheduling_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid,
	"rule_type" "rule_type" NOT NULL,
	"name" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" "rule_outcome" NOT NULL,
	"overridable" boolean DEFAULT false NOT NULL,
	"override_permission" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"assigned_via" "assignment_via" NOT NULL,
	"assigned_by" uuid,
	"approved_by" uuid,
	"rule_evaluation" jsonb,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_time_ck" CHECK ("shift_assignments"."ends_at" > "shift_assignments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "shift_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"rule_evaluation" jsonb,
	"assignment_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_assignment_id" uuid NOT NULL,
	"target_employee_id" uuid NOT NULL,
	"target_assignment_id" uuid,
	"status" "swap_status" DEFAULT 'pending_peer' NOT NULL,
	"rule_evaluation" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"unpaid_break_minutes" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "shift_templates_facility_code_uq" UNIQUE("facility_id","code")
);
--> statement-breakpoint
CREATE TABLE "shift_waitlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid,
	"facility_id" uuid NOT NULL,
	"department_id" uuid,
	"unit_id" uuid,
	"position_id" uuid NOT NULL,
	"shift_template_id" uuid,
	"work_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"paid_hours" numeric(5, 2) NOT NULL,
	"required_count" integer NOT NULL,
	"source" "shift_source" DEFAULT 'budget' NOT NULL,
	"budget_requirement_id" uuid,
	"status" "shift_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "shifts_time_ck" CHECK ("shifts"."ends_at" > "shifts"."starts_at"),
	CONSTRAINT "shifts_required_ck" CHECK ("shifts"."required_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staffing_budget_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"unit_id" uuid,
	"position_id" uuid NOT NULL,
	"shift_template_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"required_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_req_uq" UNIQUE NULLS NOT DISTINCT("template_id","unit_id","position_id","shift_template_id","day_of_week"),
	CONSTRAINT "budget_req_dow_ck" CHECK ("staffing_budget_requirements"."day_of_week" between 0 and 6),
	CONSTRAINT "budget_req_count_ck" CHECK ("staffing_budget_requirements"."required_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staffing_budget_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"copied_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "timekeeping_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" "record_source" NOT NULL,
	"external_id" text NOT NULL,
	"external_employee_key" text,
	"employee_id" uuid,
	"facility_id" uuid,
	"external_facility" text,
	"work_date" date NOT NULL,
	"punch_in" timestamp with time zone,
	"punch_out" timestamp with time zone,
	"hours" numeric(6, 2),
	"approved" boolean,
	"sync_log_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timekeeping_source_external_uq" UNIQUE("organization_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "units_department_name_uq" UNIQUE("department_id","name")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"facility_id" uuid,
	"department_id" uuid,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_scope_ck" CHECK (("user_roles"."scope_type" in ('organization','pool') and "user_roles"."facility_id" is null and "user_roles"."department_id" is null)
       or ("user_roles"."scope_type" = 'facility' and "user_roles"."facility_id" is not null and "user_roles"."department_id" is null)
       or ("user_roles"."scope_type" = 'department' and "user_roles"."facility_id" is not null and "user_roles"."department_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"employee_id" uuid,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_assignment_id_shift_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."shift_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_types" ADD CONSTRAINT "credential_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability" ADD CONSTRAINT "employee_availability_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability" ADD CONSTRAINT "employee_availability_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability" ADD CONSTRAINT "employee_availability_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_credentials" ADD CONSTRAINT "employee_credentials_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_credentials" ADD CONSTRAINT "employee_credentials_credential_type_id_credential_types_id_fk" FOREIGN KEY ("credential_type_id") REFERENCES "public"."credential_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_credentials" ADD CONSTRAINT "employee_credentials_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_facility_authorizations" ADD CONSTRAINT "employee_facility_authorizations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_facility_authorizations" ADD CONSTRAINT "employee_facility_authorizations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_facility_authorizations" ADD CONSTRAINT "employee_facility_authorizations_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_facility_authorizations" ADD CONSTRAINT "employee_facility_authorizations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pay_rates" ADD CONSTRAINT "employee_pay_rates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_positions" ADD CONSTRAINT "employee_positions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_positions" ADD CONSTRAINT "employee_positions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_positions" ADD CONSTRAINT "employee_positions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_preferences" ADD CONSTRAINT "employee_preferences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_home_facility_id_facilities_id_fk" FOREIGN KEY ("home_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_home_department_id_departments_id_fk" FOREIGN KEY ("home_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_positions" ADD CONSTRAINT "facility_positions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_positions" ADD CONSTRAINT "facility_positions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_field_mappings" ADD CONSTRAINT "integration_field_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_field_mappings" ADD CONSTRAINT "integration_field_mappings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_field_mappings" ADD CONSTRAINT "integration_field_mappings_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_field_mappings" ADD CONSTRAINT "integration_field_mappings_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_logs" ADD CONSTRAINT "integration_sync_logs_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_rules" ADD CONSTRAINT "overtime_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_rules" ADD CONSTRAINT "overtime_rules_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_rules" ADD CONSTRAINT "overtime_rules_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_credential_requirements" ADD CONSTRAINT "position_credential_requirements_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_credential_requirements" ADD CONSTRAINT "position_credential_requirements_credential_type_id_credential_types_id_fk" FOREIGN KEY ("credential_type_id") REFERENCES "public"."credential_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_rule_id_scheduling_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."scheduling_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_rules" ADD CONSTRAINT "scheduling_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_rules" ADD CONSTRAINT "scheduling_rules_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_rules" ADD CONSTRAINT "scheduling_rules_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_claims" ADD CONSTRAINT "shift_claims_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_claims" ADD CONSTRAINT "shift_claims_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_claims" ADD CONSTRAINT "shift_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_claims" ADD CONSTRAINT "shift_claims_assignment_id_shift_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."shift_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_claims" ADD CONSTRAINT "shift_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_assignment_id_shift_assignments_id_fk" FOREIGN KEY ("requester_assignment_id") REFERENCES "public"."shift_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_employee_id_employees_id_fk" FOREIGN KEY ("target_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_assignment_id_shift_assignments_id_fk" FOREIGN KEY ("target_assignment_id") REFERENCES "public"."shift_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_waitlists" ADD CONSTRAINT "shift_waitlists_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_waitlists" ADD CONSTRAINT "shift_waitlists_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_budget_requirement_id_staffing_budget_requirements_id_fk" FOREIGN KEY ("budget_requirement_id") REFERENCES "public"."staffing_budget_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_budget_requirements" ADD CONSTRAINT "staffing_budget_requirements_template_id_staffing_budget_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."staffing_budget_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_budget_requirements" ADD CONSTRAINT "staffing_budget_requirements_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_budget_requirements" ADD CONSTRAINT "staffing_budget_requirements_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_budget_requirements" ADD CONSTRAINT "staffing_budget_requirements_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_budget_templates" ADD CONSTRAINT "staffing_budget_templates_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staffing_budget_templates" ADD CONSTRAINT "staffing_budget_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timekeeping_records" ADD CONSTRAINT "timekeeping_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timekeeping_records" ADD CONSTRAINT "timekeeping_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timekeeping_records" ADD CONSTRAINT "timekeeping_records_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_pending_idx" ON "approval_requests" USING btree ("facility_id","status");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_facility_idx" ON "audit_logs" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE INDEX "employee_availability_emp_idx" ON "employee_availability" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_credentials_emp_idx" ON "employee_credentials" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "efa_active_uq" ON "employee_facility_authorizations" USING btree ("employee_id","facility_id") WHERE "employee_facility_authorizations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "efa_facility_idx" ON "employee_facility_authorizations" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "employee_pay_rates_emp_idx" ON "employee_pay_rates" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_positions_primary_uq" ON "employee_positions" USING btree ("employee_id") WHERE "employee_positions"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "employees_paycor_uq" ON "employees" USING btree ("organization_id","paycor_employee_id") WHERE "employees"."paycor_employee_id" is not null;--> statement-breakpoint
CREATE INDEX "employees_org_status_idx" ON "employees" USING btree ("organization_id","employment_status");--> statement-breakpoint
CREATE INDEX "employees_home_facility_idx" ON "employees" USING btree ("home_facility_id");--> statement-breakpoint
CREATE INDEX "employees_number_idx" ON "employees" USING btree ("organization_id","employee_number");--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree (lower("last_name"),lower("first_name"));--> statement-breakpoint
CREATE INDEX "facilities_org_idx" ON "facilities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sync_logs_provider_started_idx" ON "integration_sync_logs" USING btree ("organization_id","provider","started_at");--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "listings_status_publish_idx" ON "marketplace_listings" USING btree ("status","publish_at","expires_at");--> statement-breakpoint
CREATE INDEX "listings_facility_idx" ON "marketplace_listings" USING btree ("facility_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_one_live_per_shift_uq" ON "marketplace_listings" USING btree ("shift_id") WHERE "marketplace_listings"."status" in ('scheduled','open');--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_employee_idx" ON "notifications" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "schedules_facility_period_idx" ON "schedules" USING btree ("facility_id","period_start");--> statement-breakpoint
CREATE INDEX "scheduling_rules_scope_idx" ON "scheduling_rules" USING btree ("organization_id","facility_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_active_uq" ON "shift_assignments" USING btree ("shift_id","employee_id") WHERE "shift_assignments"."status" = 'assigned';--> statement-breakpoint
CREATE INDEX "assignments_employee_start_idx" ON "shift_assignments" USING btree ("employee_id","starts_at");--> statement-breakpoint
CREATE INDEX "assignments_shift_idx" ON "shift_assignments" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_active_uq" ON "shift_claims" USING btree ("listing_id","employee_id") WHERE "shift_claims"."status" in ('pending','approved','auto_approved');--> statement-breakpoint
CREATE INDEX "claims_employee_idx" ON "shift_claims" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "claims_listing_idx" ON "shift_claims" USING btree ("listing_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_active_uq" ON "shift_waitlists" USING btree ("shift_id","employee_id") WHERE "shift_waitlists"."status" in ('waiting','offered');--> statement-breakpoint
CREATE INDEX "shifts_facility_start_idx" ON "shifts" USING btree ("facility_id","starts_at");--> statement-breakpoint
CREATE INDEX "shifts_schedule_idx" ON "shifts" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "budget_templates_facility_idx" ON "staffing_budget_templates" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "timekeeping_employee_date_idx" ON "timekeeping_records" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_active_uq" ON "user_roles" USING btree ("user_id","role_id","scope_type","facility_id","department_id") WHERE "user_roles"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_uq" ON "users" USING btree ("employee_id") WHERE "users"."employee_id" is not null;