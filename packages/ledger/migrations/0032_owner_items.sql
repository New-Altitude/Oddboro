ALTER TABLE "asks" ADD COLUMN IF NOT EXISTS "needs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "needs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;