ALTER TABLE "asks" ADD COLUMN "standing" jsonb;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "tool_notes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "standing" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "ask_first" text[] DEFAULT '{}' NOT NULL;