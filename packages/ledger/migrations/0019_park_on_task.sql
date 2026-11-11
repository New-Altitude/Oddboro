ALTER TABLE "follow_ups" ADD COLUMN "picked_up" text[];--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "unparked_task" integer;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "unparked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "resume_on_task" integer;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_unparked_task_tasks_id_fk" FOREIGN KEY ("unparked_task") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_resume_on_task_tasks_id_fk" FOREIGN KEY ("resume_on_task") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;