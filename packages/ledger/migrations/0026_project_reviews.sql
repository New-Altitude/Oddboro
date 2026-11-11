CREATE TABLE "project_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"slug" text NOT NULL,
	"source" jsonb NOT NULL,
	"question" text NOT NULL,
	"message" text NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"answer" text,
	"reason" text,
	"recommendation" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN "goal_id" integer;--> statement-breakpoint
ALTER TABLE "project_reviews" ADD CONSTRAINT "project_reviews_session_id_project_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reviews" ADD CONSTRAINT "project_reviews_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reviews" ADD CONSTRAINT "project_reviews_persona_id_staff_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reviews" ADD CONSTRAINT "project_reviews_request_id_project_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."project_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER project_reviews_change AFTER INSERT OR UPDATE OR DELETE ON project_reviews FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
