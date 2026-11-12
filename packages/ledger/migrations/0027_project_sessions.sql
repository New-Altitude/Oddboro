CREATE TABLE "project_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"staff_id" text,
	"thread_id" integer,
	"prompt" text NOT NULL,
	"file" text,
	"state" text NOT NULL,
	"turn" text,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"native_id" text NOT NULL,
	"folder" text NOT NULL,
	"title" text NOT NULL,
	"staff_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_sessions_agent_native_id_key" UNIQUE("agent","native_id"),
	CONSTRAINT "project_sessions_agent_check" CHECK ("project_sessions"."agent" IN ('claude', 'codex'))
);
--> statement-breakpoint
ALTER TABLE "project_requests" ADD CONSTRAINT "project_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."project_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requests" ADD CONSTRAINT "project_requests_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_requests" ADD CONSTRAINT "project_requests_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_requests_session" ON "project_requests" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE TRIGGER project_sessions_notify AFTER INSERT OR UPDATE OR DELETE ON project_sessions FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
--> statement-breakpoint
CREATE TRIGGER project_requests_notify AFTER INSERT OR UPDATE OR DELETE ON project_requests FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
