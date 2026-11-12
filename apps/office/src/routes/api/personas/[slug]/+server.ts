// One persona's own sign-in. POST starts it (Add and Reconnect) and answers
// the page to open, or '' when a kept sign-in still worked. Its `askId` names
// the hire ask whose window added it, which its join answers. DELETE is
// Disconnect: the sign-in ends and the persona's Odd goes quiet.
import { error, json } from '@sveltejs/kit';
import { SignInRefused } from '#lib/server/account.ts';
import { UntrustedCertificate } from '#lib/server/oauth.ts';
import { disconnectPersona, NotOffered, startPersonaGrant } from '#lib/server/persona.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const b = (await request.json().catch(() => ({}))) as { askId?: unknown };
  const askId = Number.isInteger(b.askId) ? (b.askId as number) : undefined;
  try {
    return json(await startPersonaGrant(params.slug, askId));
  } catch (e) {
    if (e instanceof NotOffered) error(404, e.message);
    if (e instanceof SignInRefused) error(409, e.message);
    console.error('[persona]', e);
    if (e instanceof UntrustedCertificate) error(502, e.message);
    error(502, 'New Altitude did not answer. Try again in a minute.');
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    await disconnectPersona(params.slug);
  } catch (e) {
    if (e instanceof SignInRefused) error(409, e.message);
    throw e;
  }
  return json({ ok: true });
};
