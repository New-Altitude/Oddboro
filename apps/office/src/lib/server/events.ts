// One bus for everything the page should hear about: a table changed (from
// Postgres NOTIFY, whichever process wrote it), a staffer started or stopped
// working, or the New Altitude sign-in changed. /api/events streams it to the
// page. Nothing polls.
import { EventEmitter } from 'node:events';
import { LOCAL, pg } from '@oddboro/ledger';
import { listenLocal } from '@oddboro/ledger/local-db';
import type { AccountStatus } from '../account.ts';
import type { Work } from '../staff/work.ts';

export type OfficeEvent =
  | { type: 'change'; table: string }
  | { type: 'working'; working: Record<string, string>; inProgress: Record<string, Work[]> }
  | { type: 'account'; status: AccountStatus };

type Bus = EventEmitter & { listening?: Promise<unknown> };
const g = globalThis as unknown as { officeBus?: Bus };
// One bus per process, even when Vite reloads this module.
export const bus: Bus = (g.officeBus ??= new EventEmitter().setMaxListeners(50));

export function listen(): void {
  const change = (table: string) => bus.emit('event', { type: 'change', table });
  // The office's own database hears NOTIFY in this process, not over a connection.
  if (LOCAL) bus.listening ??= Promise.resolve(listenLocal('office', change));
  else bus.listening ??= pg.listen('office', change);
}

export function emit(e: OfficeEvent): void {
  bus.emit('event', e);
}
