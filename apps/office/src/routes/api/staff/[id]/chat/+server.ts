// Keep the owner's exact submission before starting a reply. Attachments
// already uploaded and inline imports share the same saved-turn path.
import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { DESK_ITEMS } from '@oddboro/ledger/desk-answers';
import { FILES_MAX } from '#lib/attachments.ts';
import { CHAT_REQUEST_BYTES, type OwnerInput } from '#lib/staff/chat-input.ts';
import type { ChatEvent } from '#lib/staff/chat.ts';
import { attachedFiles } from '#lib/server/chat-files.ts';
import { keepOwnerTurn, ChatInputError } from '#lib/server/chat-turns.ts';
import { chatLog, isBusy, isStaff } from '#lib/server/staff.ts';
import {
  replyToOwnerTurn,
  activeReply,
  correctionSource,
  stopReply
} from '#lib/server/chat-run.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  return json({
    history: await chatLog(params.id),
    busy: isBusy(params.id),
    reply: activeReply(params.id)
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  if (Number(request.headers.get('content-length')) > CHAT_REQUEST_BYTES)
    error(413, 'Use up to 8 MiB of text and inline files per message.');
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    error(400, 'Send a chat message.');
  // A JSON object was checked above. Every field is checked before it is used.
  const body = parsed as Record<string, unknown>;
  const { instead, about } = body;
  if (
    (instead !== undefined && typeof instead !== 'string') ||
    (about !== undefined && typeof about !== 'string')
  )
    error(400, 'Choose the work to correct.');
  if (instead && (about || !('message' in body))) error(400, 'Choose one reply to correct.');
  if (!instead && isBusy(params.id)) error(409, 'Still replying to the last message');
  const turnId = body.turnId ?? randomUUID();
  if (typeof turnId !== 'string' || (!('message' in body) && !body.turnId))
    error(400, 'Send a chat message.');
  const r =
    body.re && typeof body.re === 'object' ? (body.re as Record<string, unknown>) : undefined;
  const kind = DESK_ITEMS.find((k) => k === r?.kind);
  const re =
    kind && typeof r?.id === 'number' && Number.isInteger(r.id) ? { kind, id: r.id } : undefined;
  if ('message' in body) {
    if (typeof body.message !== 'string') error(400, 'Send a chat message.');
    let source: OwnerInput['source'];
    try {
      source = instead ? correctionSource(params.id, instead) : { kind: 'chat' };
    } catch (e) {
      error(400, e instanceof Error ? e.message : String(e));
    }
    const input: OwnerInput = { turnId, message: body.message, source };
    if (body.files !== undefined) {
      if (!Array.isArray(body.files) || body.files.length > FILES_MAX)
        error(400, `Attach up to ${FILES_MAX} files at a time.`);
      if (body.files.some((f) => f && typeof f === 'object' && 'data' in f)) {
        input.files = body.files.map((f: unknown) => {
          if (
            !f ||
            typeof f !== 'object' ||
            !('name' in f) ||
            typeof f.name !== 'string' ||
            !('data' in f) ||
            typeof f.data !== 'string' ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data) ||
            f.data.length % 4 !== 0
          )
            error(400, 'Choose a file.');
          return { name: f.name, bytes: Buffer.from(f.data, 'base64') };
        });
      } else {
        try {
          input.kept = attachedFiles(params.id, body.files);
        } catch (e) {
          error(400, e instanceof Error ? e.message : String(e));
        }
      }
    }
    try {
      await keepOwnerTurn(params.id, input, re, about);
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

export const DELETE: RequestHandler = async ({ params, request }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object' || !('runId' in body) || typeof body.runId !== 'string')
    error(400, 'Choose the reply to stop.');
  return json({ stopped: await stopReply(params.id, body.runId) });
};
