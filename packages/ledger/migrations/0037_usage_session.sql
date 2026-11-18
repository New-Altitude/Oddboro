ALTER TABLE "usage" ADD COLUMN "session" text;--> statement-breakpoint
CREATE INDEX "usage_by_session" ON "usage" USING btree ("session","model");