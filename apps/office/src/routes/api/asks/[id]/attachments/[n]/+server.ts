// One file an Odd attached to an email it proposed (a reply ask), for its
// preview in the review: only a file the ask names, checked again in the
// Odd's folder. A picture shows in the page; anything else downloads, never
// sniffed as anything but its type and never run as a page.
import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { ask, mailAttachment, mailAttachmentPath } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const a = await ask(Number(params.id));
  const named = a?.kind === 'reply' ? a.reply?.attachments?.[Number(params.n)] : undefined;
  if (!a || !named) error(404, 'No such file');
  const file = mailAttachment(a.staffId, named.path);
  if ('problem' in file) error(404, 'That file is no longer in the folder');
  const picture = /^image\/(png|jpeg|gif|webp)$/.test(file.mediaType);
  return new Response(readFileSync(mailAttachmentPath(a.staffId, file)), {
    headers: {
      'content-type': picture ? file.mediaType : 'application/octet-stream',
      'content-disposition': picture
        ? 'inline'
        : `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      'cache-control': 'no-store'
    }
  });
};
