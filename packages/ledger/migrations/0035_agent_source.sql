-- Keep source identities already saved by an earlier import build.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "agent_source" jsonb;
--> statement-breakpoint
UPDATE "staff" SET "agent_source" = jsonb_build_object('format', 'claude', 'name', "claude_agent_name")
WHERE "agent_source" IS NULL AND "claude_agent_name" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN "claude_agent_name";
