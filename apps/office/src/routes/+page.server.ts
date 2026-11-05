import {
  desk,
  MAC,
  roomNamesFor,
  roster,
  switchedOffIn,
  unreadPokes,
  welcomed,
  zone
} from '@oddboro/ledger';
import { keepAddress } from '#lib/server/address.ts';
import { diagnosticsState } from '#lib/server/diagnostics.ts';
import { currentOffice } from '#lib/server/space.ts';
import { toProfile } from '#lib/staff/roster.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // The owner's Caddy may have dropped the office's site since: put it back.
  void keepAddress();
  const first = !(await welcomed());
  // A new owner arrives at an empty lot; the office goes up on it as they finish.
  const office = await currentOffice({ lot: first });
  return {
    office,
    // The sample office, to move into if the owner's own does not come out.
    sample: first ? (await currentOffice()).world : undefined,
    staff: (await roster()).map(toProfile),
    desk: await desk(),
    roomNames: await roomNamesFor(office.id),
    switchedOff: await switchedOffIn(office.id),
    messages: await unreadPokes(),
    zone: zone(),
    /** What the header calls this computer. */
    computer: MAC ? 'Your Mac' : 'Your computer',
    welcomed: !first,
    diagnostics: diagnosticsState()
  };
};
