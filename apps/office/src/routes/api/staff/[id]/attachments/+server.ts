// One file the owner attaches to a chat message, kept in the Odd's attachments folder
// before the message goes. The body is the file's bytes, sent as
// application/octet-stream so the server's form check never applies; its
// name and type ride in headers.
import { error, json } from '@sveltejs/kit';
import { isFixedError } from '@oddboro/ledger/errors';
import { isStaff } from '#lib/server/staff.ts';
import { keepAttachment } from '#lib/server/chat-files.ts';
import { FILE_MAX, refusal } from '#lib/attachments.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  let name = '';
  try {
    name = decodeURIComponent(request.headers.get('x-file-name') ?? '');
  } catch {
    error(400, 'That file name could not be read');
  }
  const type = request.headers.get('x-media-type') ?? '';
  if (Number(request.headers.get('content-length') ?? 0) > FILE_MAX)
    error(413, `${name || 'That file'} is over 10 MB.`);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const refused = refusal(name, type, bytes.byteLength);
  if (refused) error(bytes.byteLength > FILE_MAX ? 413 : 400, refused);
  try {
    return json(keepAttachment(params.id, name, type, bytes));
  } catch (e) {
    // A refusal the office wrote reads as written; a disk error goes to the log.
    if (isFixedError(e)) error(409, e.message);
    throw e;
  }
};
