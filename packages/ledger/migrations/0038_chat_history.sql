CREATE TABLE "chat_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_id" text NOT NULL,
	"key" text NOT NULL,
	"run_id" text,
	"at" timestamp with time zone NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	CONSTRAINT "chat_history_one_row" UNIQUE("staff_id","key")
);
--> statement-breakpoint
ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_history_by_run" ON "chat_history" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "chat_history_embedding" ON "chat_history" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chat_history_words" ON "chat_history" USING gin (to_tsvector('english', "owner" || ' ' || "reply"));