CREATE TABLE "work_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" text NOT NULL,
	"thread_id" integer NOT NULL,
	"staff_id" text NOT NULL,
	"message" text NOT NULL,
	"reply" text,
	"status" text DEFAULT 'replying' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "work_messages_requestId_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "work_messages" ADD CONSTRAINT "work_messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_messages" ADD CONSTRAINT "work_messages_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_messages_thread_id_idx" ON "work_messages" USING btree ("thread_id");
--> statement-breakpoint
CREATE TRIGGER work_messages_changed AFTER INSERT OR UPDATE OR DELETE ON work_messages FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
