CREATE TABLE "persona_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_id" text NOT NULL,
	"identity" text NOT NULL,
	"continuation" text NOT NULL,
	"goal_id" integer,
	"thread_id" integer,
	"task_id" integer,
	"slug" text,
	"staff_id" text,
	"installed_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"superseded_tasks" integer[] DEFAULT '{}' NOT NULL,
	"resumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_revisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "persona_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_id" text NOT NULL,
	"slug" text NOT NULL,
	"previous" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_requests" ADD CONSTRAINT "persona_requests_requester_id_staff_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_requests" ADD CONSTRAINT "persona_requests_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_requests" ADD CONSTRAINT "persona_requests_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_requests" ADD CONSTRAINT "persona_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_requests" ADD CONSTRAINT "persona_requests_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_requests" ADD CONSTRAINT "persona_requests_installed_id_staff_id_fk" FOREIGN KEY ("installed_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX persona_request_slug ON persona_requests (slug) WHERE state = 'approved';
--> statement-breakpoint
CREATE UNIQUE INDEX persona_request_staff ON persona_requests (staff_id) WHERE state = 'approved';
--> statement-breakpoint
CREATE TRIGGER persona_requests_change AFTER INSERT OR UPDATE OR DELETE ON persona_requests FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
