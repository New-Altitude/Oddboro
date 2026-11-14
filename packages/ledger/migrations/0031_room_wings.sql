CREATE TABLE "room_wings" (
	"office" text NOT NULL,
	"room" text NOT NULL,
	"wing" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_wings_office_room_pk" PRIMARY KEY("office","room")
);
--> statement-breakpoint
CREATE TRIGGER room_wings_notify AFTER INSERT OR UPDATE OR DELETE ON room_wings FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
