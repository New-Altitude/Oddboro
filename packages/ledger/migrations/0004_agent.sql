-- IF NOT EXISTS by hand: a trial office that ran this column's first form,
-- 0011_agent, already has it, and its journal time sits before this one's.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "agent" text DEFAULT 'claude' NOT NULL;
