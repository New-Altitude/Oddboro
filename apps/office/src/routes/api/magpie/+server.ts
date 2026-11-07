import { json } from '@sveltejs/kit';
import { fromOwnerPage } from '#lib/server/owner-page.ts';
import { MagpieError, magpieAction, magpieState } from '#lib/server/magpie.ts';
import type { MagpieAction } from '#lib/magpie.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  // This page includes private local account metadata. Reads require the owner too.
  if (!fromOwnerPage(request))
    return json({ message: 'Open Models & connections from the office page.' }, { status: 403 });
  return json(await magpieState(), { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async ({ request }) => {
  if (!fromOwnerPage(request))
    return json({ message: 'Only the office page can change Magpie.' }, { status: 403 });
  const limit = 64 * 1024;
  const reader = request.body?.getReader();
  if (!reader) return json({ message: 'Choose a Magpie action.' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) {
        await reader.cancel();
        return json({ message: 'Magpie action is too large.' }, { status: 413 });
      }
      chunks.push(next.value);
    }
    const action = JSON.parse(Buffer.concat(chunks).toString('utf8')) as MagpieAction;
    return json(await magpieAction(action), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json(
      {
        message:
          error instanceof MagpieError ? error.message : 'Magpie could not complete this action.'
      },
      { status: error instanceof MagpieError ? error.status : 400 }
    );
  }
};
