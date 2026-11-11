ALTER TABLE "asks" ADD COLUMN "odd" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "jobs_off" integer[];--> statement-breakpoint
-- Every Office Manager can now let an Odd go and bring one back, each with the owner's yes.
UPDATE "staff" SET "tools" = "tools" || ARRAY['remove_odd', 'bring_back_odd']::text[]
  WHERE "role" = 'Office Manager' AND NOT ('remove_odd' = ANY("tools"));
