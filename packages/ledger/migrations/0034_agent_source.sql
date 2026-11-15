ALTER TABLE "staff" RENAME COLUMN "claude_agent_name" TO "agent_source";
--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "agent_source" TYPE jsonb USING
  CASE WHEN "agent_source" IS NULL THEN NULL
       ELSE jsonb_build_object('format', 'claude', 'name', "agent_source") END;
