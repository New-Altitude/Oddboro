CREATE TABLE "persona_consultations" (
	"key" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"asked" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"preparation" jsonb,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_consultations" ADD CONSTRAINT "persona_consultations_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;