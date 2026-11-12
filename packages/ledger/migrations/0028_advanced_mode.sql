ALTER TABLE "owner" ADD COLUMN "advanced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN "sends_unasked" text;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_sends_unasked_fkey" FOREIGN KEY ("sends_unasked") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;