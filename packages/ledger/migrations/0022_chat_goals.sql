ALTER TABLE "goals" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_requestId_unique" UNIQUE("request_id");