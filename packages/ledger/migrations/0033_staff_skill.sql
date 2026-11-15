-- An office that tested the earlier skill branch can have skill but no hand-off setting.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "acts_on_hand_offs" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "skill" text;
