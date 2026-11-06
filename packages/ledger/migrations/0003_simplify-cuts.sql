-- Written by hand. An office that ran an earlier form of 0002 still has the
-- columns below that this drops, and rows that name a thread status and an ask
-- kind the office no longer has. This takes them out, and adds `asks.held`,
-- which that form lacks. A fresh office has none of them and has `held`, so
-- here it changes nothing.
ALTER TABLE "usage" DROP CONSTRAINT IF EXISTS "usage_follow_up_id_follow_ups_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "usage_by_follow_up";--> statement-breakpoint
ALTER TABLE "usage" DROP COLUMN IF EXISTS "follow_up_id";--> statement-breakpoint
ALTER TABLE "asks" DROP COLUMN IF EXISTS "hand_offs";--> statement-breakpoint
ALTER TABLE "asks" DROP COLUMN IF EXISTS "share";--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN IF NOT EXISTS "held" jsonb;--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN IF EXISTS "budget";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN IF EXISTS "budget_why";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN IF EXISTS "round_at";--> statement-breakpoint
UPDATE "threads" SET "status" = 'open' WHERE "status" = 'waiting';--> statement-breakpoint
UPDATE "asks" SET "kind" = 'approval' WHERE "kind" = 'share';
