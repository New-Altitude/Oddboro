// The column helpers every table uses. schema.ts never re-exports this file,
// so the helpers stay out of the schema's names.
import { integer, timestamp } from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true });
const created = (name = 'created_at') => at(name).notNull().defaultNow();
const id = () => integer().primaryKey().generatedAlwaysAsIdentity();

export { at, created, id };
