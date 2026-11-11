-- Written by hand: the Ledger window hears each new ledger row, and the
-- office hears each change to the accounts.
CREATE TRIGGER ledger_notify AFTER INSERT OR UPDATE OR DELETE ON ledger FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
--> statement-breakpoint
CREATE TRIGGER accounts_notify AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH STATEMENT EXECUTE FUNCTION office_notify();
