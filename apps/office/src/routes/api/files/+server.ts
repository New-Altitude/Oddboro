// A staffer's file, for the viewer: GET reads it, PUT saves the owner's edit.
import { error, json } from '@sveltejs/kit';
import { ownerMessage, readStaffFile, writeStaffFile } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const path = url.searchParams.get('path') ?? '';
  try {
    return json(await readStaffFile(url.searchParams.get('staff') ?? '', path));
  } catch (e) {
    error(404, ownerMessage(e, path, 'Could not open the file'));
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.staff !== 'string' || typeof b.path !== 'string') error(400, 'Name the file');
  if (typeof b.content !== 'string' || typeof b.mtime !== 'number') error(400, 'Nothing to save');
  try {
    return json(await writeStaffFile(b.staff, b.path, b.content, b.mtime));
  } catch (e) {
    error(409, ownerMessage(e, b.path, 'Could not save the file'));
  }
};
