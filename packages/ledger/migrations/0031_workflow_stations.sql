CREATE TABLE "station_jobs" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"thread_id" integer,
	"job" text NOT NULL,
	"stations" jsonb NOT NULL,
	"station" integer DEFAULT 0 NOT NULL,
	"from_station" integer,
	"last_result" integer,
	"pending" boolean DEFAULT false NOT NULL,
	CONSTRAINT "station_jobs_threadId_unique" UNIQUE("thread_id")
);
--> statement-breakpoint
CREATE TABLE "station_workflows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "station_workflows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"stations" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "station_jobs" ADD CONSTRAINT "station_jobs_workflow_id_station_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."station_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_jobs" ADD CONSTRAINT "station_jobs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER station_workflows_notify AFTER INSERT OR UPDATE OR DELETE ON station_workflows FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
--> statement-breakpoint
CREATE TRIGGER station_jobs_notify AFTER INSERT OR UPDATE OR DELETE ON station_jobs FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
