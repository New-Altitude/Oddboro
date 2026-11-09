// Download only a file the owner attached to this turn in this Odd's chat.
import { readFileSync } from 'node:fs';
import { error } from '@sveltejs/kit';
import { history, isStaff } from '#lib/server/staff.ts';
import { attachmentPath } from '#lib/server/chat-files.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  const owner = history(params.id).find((e) => e.from === 'owner' && e.turnId === params.turnId);
  const file = /^\d+$/.test(params.index) && owner?.attachments?.[Number(params.index)];
  if (!file) error(404, 'No such attachment');
  return new Response(readFileSync(attachmentPath(params.id, file)), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", '%27')}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
};
