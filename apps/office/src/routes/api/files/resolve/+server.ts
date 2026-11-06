// Which file names in an Odd's text open, in the viewer or (a page) in the browser: POST { files: [{ staff, path }] }
// answers the path each opens by, or null, in the same order.
import { error, json } from '@sveltejs/kit';
import { openableFiles, type FileName } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

const isName = (f: unknown): f is FileName =>
  typeof f === 'object' &&
  f !== null &&
  typeof (f as FileName).staff === 'string' &&
  typeof (f as FileName).path === 'string';

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { files?: unknown };
  if (!Array.isArray(b.files) || !b.files.every(isName)) error(400, 'Name the files');
  return json(await openableFiles(b.files));
};
