CREATE TABLE "result_editions" (
	"id" text PRIMARY KEY NOT NULL,
	"result_id" integer NOT NULL,
	"day" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"revision" integer NOT NULL,
	"destination" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{"gaps":[]}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"repair_run" integer,
	"repair_sha" text,
	"report_id" integer,
	"desk_at" timestamp with time zone,
	"delivery" text DEFAULT 'waiting' NOT NULL,
	"message_id" text NOT NULL,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"next_check" timestamp with time zone,
	"approved_hash" text,
	"accepted_at" timestamp with time zone,
	"receipt" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_editions_resultId_day_unique" UNIQUE("result_id","day")
);
--> statement-breakpoint
CREATE TABLE "scheduled_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scheduled_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"producer_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"thread_id" integer NOT NULL,
	"responsible_id" text NOT NULL,
	"title" text NOT NULL,
	"deadline" text NOT NULL,
	"zone" text NOT NULL,
	"destination" jsonb NOT NULL,
	"repairs" integer DEFAULT 2 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"producer_changed_at" timestamp with time zone NOT NULL,
	"reviewer_changed_at" timestamp with time zone NOT NULL,
	"last_day" text,
	"incident_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_results_producerId_unique" UNIQUE("producer_id")
);
--> statement-breakpoint
ALTER TABLE "result_editions" ADD CONSTRAINT "result_editions_result_id_scheduled_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."scheduled_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_editions" ADD CONSTRAINT "result_editions_repair_run_runs_id_fk" FOREIGN KEY ("repair_run") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_editions" ADD CONSTRAINT "result_editions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_results" ADD CONSTRAINT "scheduled_results_producer_id_jobs_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_results" ADD CONSTRAINT "scheduled_results_reviewer_id_jobs_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_results" ADD CONSTRAINT "scheduled_results_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_results" ADD CONSTRAINT "scheduled_results_responsible_id_staff_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_results" ADD CONSTRAINT "scheduled_results_incident_id_reports_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER scheduled_results_change AFTER INSERT OR UPDATE OR DELETE ON scheduled_results FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
--> statement-breakpoint
CREATE TRIGGER result_editions_change AFTER INSERT OR UPDATE OR DELETE ON result_editions FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
