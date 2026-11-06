CREATE TABLE "lesson_uses" (
	"staff_id" text NOT NULL,
	"lesson_id" integer NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "lesson_uses_staff_id_lesson_id_pk" PRIMARY KEY("staff_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lessons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_id" text,
	"heard_by" text NOT NULL,
	"text" text NOT NULL,
	"quote" text NOT NULL,
	"applies_to" text,
	"how" text NOT NULL,
	"status" text NOT NULL,
	"replaces" integer,
	"missed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "threads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"goal_id" integer,
	"hub_id" text NOT NULL,
	"holder_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"hand_offs_used" integer DEFAULT 0 NOT NULL,
	"resume_at" timestamp with time zone,
	"held_by" integer,
	"runs" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "tools" SET DEFAULT '{"search_ledger","give_owner_a_task","find_connectors","ask_for_access","edit_my_job","edit_my_description","hand_off","poke_owner"}';--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "hand_off_id" integer;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "thread_id" integer;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "held" jsonb;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "hand_off" jsonb;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "thread_id" integer;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "edit" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "hand_off_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "thread_id" integer;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "tokens" integer GENERATED ALWAYS AS (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) STORED;--> statement-breakpoint
ALTER TABLE "lesson_uses" ADD CONSTRAINT "lesson_uses_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_uses" ADD CONSTRAINT "lesson_uses_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_heard_by_staff_id_fk" FOREIGN KEY ("heard_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_hub_id_staff_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_holder_id_staff_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_held_by_asks_id_fk" FOREIGN KEY ("held_by") REFERENCES "public"."asks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lessons_by_staff" ON "lessons" USING btree ("staff_id","status");--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Written by hand: Odds hired before hand-offs get the tool, as new hires do.
UPDATE "staff" SET "tools" = array(SELECT DISTINCT unnest("tools" || ARRAY['hand_off']));
--> statement-breakpoint

-- Written by hand: the chat hears when a thread moves, and the chat and the
-- Lessons tab hear when a lesson is kept, changed or used.
CREATE TRIGGER threads_notify AFTER INSERT OR UPDATE OR DELETE ON threads FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
--> statement-breakpoint
CREATE TRIGGER lessons_notify AFTER INSERT OR UPDATE OR DELETE ON lessons FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
--> statement-breakpoint
CREATE TRIGGER lesson_uses_notify AFTER INSERT OR UPDATE OR DELETE ON lesson_uses FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
