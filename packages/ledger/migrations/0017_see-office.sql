ALTER TABLE "staff" ALTER COLUMN "tools" SET DEFAULT '{"see_office","search_ledger","give_owner_a_task","find_connectors","ask_for_access","edit_my_job","edit_my_description","hand_off","poke_owner"}';--> statement-breakpoint
-- Every Odd already hired sees who is in the office, as every new hire does. Once: the owner may take it off after.
UPDATE "staff" SET "tools" = ARRAY['see_office']::text[] || "tools"
  WHERE NOT ('see_office' = ANY("tools"));
