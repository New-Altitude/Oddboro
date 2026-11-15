import { info } from '#lib/server/legal.ts';

export const load = () => ({ doc: info('backup-and-restore', 'Back up and restore your office') });
