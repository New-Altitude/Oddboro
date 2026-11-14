CREATE TABLE "publication_follows" (
	"staff_id" text PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"mode" text NOT NULL,
	"position" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "publications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account" text NOT NULL,
	"slug" text NOT NULL,
	"source_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn" boolean DEFAULT false NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	CONSTRAINT "publications_source_key" UNIQUE("account","slug","source_id")
);
--> statement-breakpoint
ALTER TABLE "publication_follows" ADD CONSTRAINT "publication_follows_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER publications_notify AFTER INSERT OR UPDATE OR DELETE ON publications FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
