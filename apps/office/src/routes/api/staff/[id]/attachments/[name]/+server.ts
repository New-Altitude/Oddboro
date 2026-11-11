// A file the owner attached in a chat, for its preview in the history and to
// open in the browser. Only a plain file in that Odd's inbox, only the types
// the office takes, and never sniffed as anything else.
import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { isStaff } from '#lib/server/staff.ts';
import { attachmentPath } from '#lib/server/chat-files.ts';
import { attachableType } from '#lib/attachments.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  const path = attachmentPath(params.id, params.name);
  const type = path && attachableType(params.name, '');
  if (!path || !type) error(404, 'No such file');
  return new Response(readFileSync(path), {
    headers: {
      'content-type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      // A kept file never changes: its name is new each time.
      'cache-control': 'private, max-age=31536000, immutable'
    }
  });
};
