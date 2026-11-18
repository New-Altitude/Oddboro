ALTER TABLE "project_sessions" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN "config_dir" text;