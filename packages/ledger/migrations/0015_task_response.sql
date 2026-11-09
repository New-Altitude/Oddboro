ALTER TABLE "tasks" ADD COLUMN "response" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "response_version" integer DEFAULT 0 NOT NULL;