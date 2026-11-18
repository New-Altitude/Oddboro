-- IF NOT EXISTS by hand: a trial office that ran this migration's earlier
-- form, under 0036, has both columns, and its journal time sits before this one's.
ALTER TABLE "project_sessions" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN IF NOT EXISTS "config_dir" text;