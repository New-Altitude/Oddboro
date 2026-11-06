// The page's reports come here, never to the door: the page posts an
// envelope, and only its events and spans go on, each through the same allow
// list the server's own pass. Then the office's transport sends it, so the
// owner's answer, the header rule and the door's size limit all apply in the
// gate (`#lib/server/diagnostics.ts`). With no address set there is no
// client, and the envelope is dropped with a 200 so the page does not retry.
import { getClient } from '@sentry/sveltekit';
import { parseEnvelope, type Envelope, type Event } from '@sentry/core';
import { scrubEvent, scrubSpan, type Scrub } from '#lib/diagnostics.ts';
import { SCRUB } from '#lib/server/diagnostics.ts';
import type { RequestHandler } from './$types';

type Item = Envelope[1][number];
type SpanContainer = { items: Parameters<typeof scrubSpan>[0][] };

const isSpanContainer = (p: unknown): p is SpanContainer =>
  !!p && typeof p === 'object' && Array.isArray((p as { items?: unknown }).items);

/** An item the office passes on, scrubbed; anything else is dropped. */
function kept([header, payload]: Item, scrub: Scrub): Item[] {
  // The page's payload is untrusted. `scrubEvent` builds a new event from its
  // allow list, so no field it does not name gets through; a payload of the
  // wrong shape throws, and nothing is sent.
  if (header.type === 'event' && payload && typeof payload === 'object')
    return [[header, scrubEvent(payload as Event, scrub)] as Item];
  if (header.type === 'span' && isSpanContainer(payload))
    return [[header, { ...payload, items: payload.items.map((s) => scrubSpan(s)) }] as Item];
  return [];
}

export const POST: RequestHandler = async ({ request, url }) => {
  const client = getClient();
  if (!client) return new Response(null);
  const [header, items] = parseEnvelope(new Uint8Array(await request.arrayBuffer()));
  // The page's code files are on the host and port it posts to, or on one of
  // the office's names when Caddy serves it. Any other port can be a tool of the owner's.
  const scrub = { ...SCRUB, host: url.host };
  // The page's header with only kept items; the gate rebuilds the header.
  const envelope = [header, items.flatMap((item) => kept(item, scrub))] as Envelope;
  if (envelope[1].length) await client.getTransport()?.send(envelope);
  return new Response(null);
};
