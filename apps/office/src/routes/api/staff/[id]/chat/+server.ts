// Chat with one staffer. GET returns the history, with everything the staffer
// put on the owner's desk where it landed; POST sends a message, optionally
// replying about one of those, and streams the reply back as server-sent events.
import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { CHAT_FILES, CHAT_REQUEST_BYTES, type OwnerInput } from '#lib/staff/chat-input.ts';
import { ChatInputError } from '#lib/server/chat-files.ts';
import {
  activeReply,
  correctionSource,
  stopReply,
  keepOwnerTurn,
  replyToOwnerTurn,
  chatLog,
  isBusy,
  isStaff,
  type ChatEvent
} from '#lib/server/staff.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  return json({
    history: await chatLog(params.id),
    busy: isBusy(params.id),
    reply: activeReply(params.id)
  });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  const body = await request.json().catch(() => null);
  if (typeof body?.runId !== 'string') error(400, 'Choose the reply to stop.');
  return json({ stopped: await stopReply(params.id, body.runId) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  let files: OwnerInput['files'];
  if (Number(request.headers.get('content-length')) > CHAT_REQUEST_BYTES)
    error(413, 'Use up to 8 MiB of text and files per message.');
  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    re?: unknown;
    turnId?: unknown;
    files?: unknown;
    about?: unknown;
    instead?: unknown;
  } | null;
  if (!body || typeof body !== 'object') error(400, 'Send a chat message.');
  const { instead, about } = body;
  if (
    (instead !== undefined && typeof instead !== 'string') ||
    (about !== undefined && typeof about !== 'string')
  )
    error(400, 'Choose the work to correct.');
  if (instead && (about || !('message' in body))) error(400, 'Choose one reply to correct.');
  if (!instead && isBusy(params.id)) error(409, 'Still replying to the last message');
  if (body.files !== undefined) {
    if (
      !Array.isArray(body.files) ||
      body.files.length > CHAT_FILES ||
      typeof body.message !== 'string'
    )
      error(400, 'Choose up to 8 files for a message.');
    files = body.files.map((f) => {
      if (
        typeof f?.name !== 'string' ||
        typeof f.data !== 'string' ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data) ||
        f.data.length % 4 !== 0
      )
        error(400, 'Choose a file.');
      return { name: f.name, bytes: Buffer.from(f.data, 'base64') };
    });
  }
  const turnId = body.turnId ?? randomUUID();
  if (typeof turnId !== 'string' || (!('message' in body) && !body.turnId))
    error(400, 'Send a chat message.');
  const r = body.re as { kind?: unknown; id?: unknown } | undefined;
  const re =
    r && ['ask', 'task', 'report'].includes(r.kind as string) && Number.isInteger(r.id)
      ? { kind: r.kind as 'ask' | 'task' | 'report', id: r.id as number }
      : undefined;
  if ('message' in body) {
    if (typeof body.message !== 'string') error(400, 'Send a chat message.');
    try {
      await keepOwnerTurn(
        params.id,
        {
          turnId,
          message: body.message,
          source: instead ? correctionSource(params.id, instead) : { kind: 'chat' },
          files
        },
        re,
        about
      );
    } catch (e) {
      if (e instanceof ChatInputError) error(400, e.message);
      throw e;
    }
  }

  const encoder = new TextEncoder();
  // The owner may close or reload the page mid-reply. The reply still finishes and
  // lands in the chat's history; writing to the gone page would crash the office.
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: ChatEvent) => {
        if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      replyToOwnerTurn(params.id, turnId, send, instead)
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
