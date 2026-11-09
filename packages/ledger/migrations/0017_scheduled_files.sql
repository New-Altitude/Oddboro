ALTER TABLE "jobs" ADD COLUMN "files" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "checked_files" jsonb;