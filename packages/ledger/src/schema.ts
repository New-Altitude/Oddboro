// Every table the office keeps, re-exported from its table modules: the Odds
// (schema-staff.ts), their asks and goals (schema-asks.ts), the owner's desk and
// the ledger, one row for every thing that was decided or done, searchable by
// meaning (schema-desk.ts), connectors, jobs, threads and runs (schema-runs.ts),
// and the office itself (schema-office.ts).

export { FOLLOW_UP_KINDS, type FollowUpKind } from './work/kinds.ts';

export * from './schema-staff.ts';
export * from './schema-asks.ts';
export * from './schema-desk.ts';
export * from './schema-runs.ts';
export * from './schema-office.ts';
