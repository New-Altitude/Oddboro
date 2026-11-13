import { error, json } from '@sveltejs/kit';
import { ConversationError, workConversation } from '@oddboro/ledger';
import { CHAT_BYTES, CHAT_ID } from '#lib/staff/chat-input.ts';
import type { ChatEvent } from '#lib/staff/chat.ts';
import {
  conversationView,
  conversationRun,
  replyOnWork,
  stopWorkReply
} from '#lib/server/work-conversations.ts';
import type { RequestHandler } from './$types';

async function workId(raw: string) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) error(400, 'Choose a piece of work.');
  try {
    await workConversation(id);
  } catch (e) {
    if (e instanceof ConversationError) error(404, e.message);
    throw e;
  }
  return id;
}

export const GET: RequestHandler = async ({ params }) =>
  json(await conversationView(await workId(params.id)));

export const POST: RequestHandler = async ({ params, request }) => {
  const threadId = await workId(params.id);
  if (Number(request.headers.get('content-length')) > CHAT_BYTES)
    error(413, 'Use up to 8 MiB of text.');
  const body: unknown = await request.json().catch(() => undefined);
  if (
    !body ||
    typeof body !== 'object' ||
    !('requestId' in body) ||
    typeof body.requestId !== 'string' ||
    !CHAT_ID.test(body.requestId) ||
    !('staffId' in body) ||
    typeof body.staffId !== 'string' ||
    !('message' in body) ||
    typeof body.message !== 'string' ||
    !body.message.trim()
  )
    error(400, 'Choose who should answer and write a message.');
  if (Buffer.byteLength(body.message) > CHAT_BYTES) error(413, 'Use up to 8 MiB of text.');
  if (conversationRun(threadId)) error(409, 'This conversation is still waiting for its reply.');
  const { staffId, requestId, message } = body;
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ChatEvent) => {
        if (open) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      // Closing the view never cancels a saved turn. A disconnected reader gets
      // the finished reply from the database when it next opens the work.
      void replyOnWork({ threadId, staffId, requestId, message }, send)
        .catch((e: unknown) =>
          send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
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
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }
  });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const threadId = await workId(params.id);
  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object' || !('runId' in body) || typeof body.runId !== 'string')
    error(400, 'Choose the reply to stop.');
  return json({ stopped: await stopWorkReply(threadId, body.runId) });
};
