CREATE TABLE project_sessions (
  id text PRIMARY KEY, agent text NOT NULL CHECK (agent IN ('claude', 'codex')),
  native_id text NOT NULL, folder text NOT NULL, title text NOT NULL,
  staff_id text REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent, native_id)
);
--> statement-breakpoint
CREATE TABLE project_requests (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES project_sessions(id),
  staff_id text REFERENCES staff(id), thread_id integer REFERENCES threads(id),
  prompt text NOT NULL, file text, state text NOT NULL, turn text, answer text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX project_requests_session ON project_requests(session_id, created_at);
--> statement-breakpoint
CREATE TRIGGER project_request_notify AFTER INSERT OR UPDATE ON project_requests FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
--> statement-breakpoint
CREATE TRIGGER project_session_notify AFTER INSERT OR UPDATE ON project_sessions FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
