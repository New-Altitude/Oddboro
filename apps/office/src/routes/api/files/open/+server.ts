// Open a page an Odd built in the owner's browser: POST { staff, path }, the
// name the viewer takes. Only the owner's own page reaches it, as with every
// action (`guardOffice` in `#lib/server/owner-page.ts`).
import { error, json } from '@sveltejs/kit';
import { openStaffPage, ownerMessage } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.staff !== 'string' || typeof b.path !== 'string') error(400, 'Name the file');
  try {
    await openStaffPage(b.staff, b.path);
  } catch (e) {
    error(404, ownerMessage(e, b.path, 'Could not open the page'));
  }
  return json({ ok: true });
};
