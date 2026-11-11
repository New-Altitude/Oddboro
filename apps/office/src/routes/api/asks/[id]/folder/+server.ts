// The owner gives the folder an Odd asked for (`ask_for_folder`), as they
// left it on the ask's card: `{ path, level, reason? }`, where `path` is the
// folder asked for or a narrower one, typed or picked, and `level` is read or
// write. The ledger checks it as the Settings tab does (`checkFolder`), gives
// it to the Odd and approves the ask in one step (`giveFolder`), so the run
// the answer starts finds the folder. A refusal leaves the ask open and says
// why in the Settings tab's words. A whole drive or system files comes back
// as `{ warning }`, given nothing, until the owner's Accept sends `accept`.
import { error, json } from '@sveltejs/kit';
import { giveFolder } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.path !== 'string' || !b.path.trim()) error(400, 'Give the folder');
  if (b.level !== 'read' && b.level !== 'write') error(400, 'Pick read or write');
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 2000) : '';
  const done = await giveFolder(
    Number(params.id),
    b.path,
    b.level,
    reason || null,
    b.accept === true
  );
  if ('refused' in done) error(done.status, done.refused);
  if ('warning' in done) return json({ warning: done.warning });
  return json({ ok: true, given: done.given });
};
