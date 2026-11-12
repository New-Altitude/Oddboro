ALTER TABLE "asks" ADD COLUMN "catch_up" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "missed" text DEFAULT 'latest' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "owed" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "skipped_at" timestamp with time zone;