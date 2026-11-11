// Chat with one staffer. GET returns the history, with everything the staffer
// put on the owner's desk where it landed; POST sends a message, optionally
// replying about one of those or with files the owner attached (kept in the
// Odd's attachments folder first, `attachments/+server.ts`), and streams the reply back as
// server-sent events.
import { error, json } from '@sveltejs/kit';
import { DESK_ITEMS, type DeskItem } from '@oddboro/ledger/desk-answers';
import { chat, chatLog, isBusy, isStaff } from '#lib/server/staff.ts';
import type { ChatEvent } from '#lib/staff/chat.ts';
import { attachedFiles } from '#lib/server/chat-files.ts';
import { FILES_MAX } from '#lib/attachments.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  return json({ history: await chatLog(params.id), busy: isBusy(params.id) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  const body = (await request.json().catch(() => ({}))) as {
    message?: unknown;
    re?: unknown;
    files?: unknown;
  };
  let files: ReturnType<typeof attachedFiles>;
  try {
    files = attachedFiles(params.id, body.files);
  } catch (err) {
    error(400, err instanceof Error ? err.message : String(err));
  }
  if (files.length > FILES_MAX) error(400, `Attach up to ${FILES_MAX} files at a time`);
  const typed = typeof body.message === 'string' ? body.message.trim() : '';
  // Files alone are a message too: their tags say it.
  const message = typed || files.map((f) => `[${f.tag}]`).join(' ');
  const r = body.re as { kind?: unknown; id?: unknown } | undefined;
  const kind = DESK_ITEMS.find((k: DeskItem) => k === r?.kind);
  const re = kind && Number.isInteger(r?.id) ? { kind, id: r?.id as number } : undefined;
  if (!message) error(400, 'Say something first');
  if (message.length > 8000) error(400, 'That message is too long');
  if (isBusy(params.id)) error(409, 'Still replying to the last message');

  const encoder = new TextEncoder();
  // The owner may close or reload the page mid-reply. The reply still finishes and
  // lands in the chat's history; writing to the gone page would crash the office.
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: ChatEvent) => {
        if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      chat(params.id, message, send, re, files)
        .catch((err: unknown) =>
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
        )
        .finally(() => {
          if (open) controller.close();
          open = false;
        });
    },
    cancel() {
      open = false;
    }
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }
  });
};
