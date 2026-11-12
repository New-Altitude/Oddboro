// The terminal and conversation are private to the owner's page, including reads.
// They exist only while Advanced mode is on; turning it off ends every stream.
import { UUID } from '#lib/server/project-sessions/native.ts';
import { error } from '@sveltejs/kit';
import { advancedMode } from '@oddboro/ledger';
import { fromOwnerPage } from '#lib/server/owner-page.ts';
import { ADVANCED_OFF, projectController } from '#lib/server/project-sessions/controller.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ request, params, url }) => {
  if (!fromOwnerPage(request)) error(403, 'Open the session in your office.');
  if (!(await advancedMode())) error(403, ADVANCED_OFF);
  const c = projectController(),
    id = params.id;
  const terminal = url.searchParams.has('terminal') ? c.openTerminal(id) : undefined;
  const view = url.searchParams.get('view') ?? '';
  if (terminal && !UUID.test(view)) error(400, 'Open a new terminal view.');
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(out) {
      const encoder = new TextEncoder();
      const send = (event: string, value: unknown) =>
        out.enqueue(
          encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(value) + '\n\n')
        );
      const state = (v: unknown) => send('session', v),
        refresh = () => send('work', true),
        bytes = (s: string) => send('output', s),
        ended = () => send('end', true),
        off = () => {
          ended();
          abort();
        };
      c.events.on(id, state);
      c.events.on('list', refresh);
      c.events.on('off', off);
      const control = () => send('control', terminal?.controls(view) ?? false);
      terminal?.take(view);
      terminal?.events.on('control', control);
      terminal?.events.on('data', bytes);
      terminal?.events.on('exit', ended);
      let closed = false;
      close = () => {
        if (closed) return;
        closed = true;
        c.events.off(id, state);
        c.events.off('list', refresh);
        c.events.off('off', off);
        terminal?.events.off('control', control);
        terminal?.release(view);
        terminal?.events.off('data', bytes);
        terminal?.events.off('exit', ended);
        request.signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        close();
        out.close();
      };
      request.signal.addEventListener('abort', abort, { once: true });
      state(c.view(id));
      if (terminal) {
        send('screen', terminal.screen);
        control();
      }
    },
    cancel() {
      close();
    }
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};
