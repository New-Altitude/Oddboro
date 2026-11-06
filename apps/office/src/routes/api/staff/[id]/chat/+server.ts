// Chat with one staffer. GET returns the history, with everything the staffer
// put on the owner's desk where it landed; POST sends a message, optionally
// replying about one of those, and streams the reply back as server-sent events.
import { error, json } from '@sveltejs/kit';
import { chat, chatLog, isBusy, isStaff, type ChatEvent } from '#lib/server/staff.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  return json({ history: await chatLog(params.id), busy: isBusy(params.id) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  const body = (await request.json().catch(() => ({}))) as { message?: unknown; re?: unknown };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const r = body.re as { kind?: unknown; id?: unknown } | undefined;
  const re =
    r && ['ask', 'task', 'report'].includes(r.kind as string) && Number.isInteger(r.id)
      ? { kind: r.kind as 'ask' | 'task' | 'report', id: r.id as number }
      : undefined;
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
      chat(params.id, message, send, re)
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
