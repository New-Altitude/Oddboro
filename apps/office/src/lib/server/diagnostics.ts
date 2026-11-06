// The office's error and trace reports: the SDK's options, and the gate every
// report passes on its way out, the server's own and the page's alike.
// `instrumentation.server.ts` loads this before the server, so nothing here
// may import the ledger's index, `address.ts` or route code: tracing hooks
// modules as they load, and those bring in Postgres.
import os from 'node:os';
import {
  getClient,
  httpIntegration,
  makeNodeTransport,
  onUnhandledRejectionIntegration,
  type NodeOptions
} from '@sentry/sveltekit';
import { serializeEnvelope, type Envelope, type Transport } from '@sentry/core';
import { readEnv } from '@oddboro/ledger/env';
import { CODE } from '@oddboro/ledger/home';
import {
  answerFrom,
  DATA_COLLECTION,
  sampleTrace,
  scrubEnvelopeHeader,
  scrubEvent,
  scrubSpan,
  type Answer,
  type Scrub
} from '#lib/diagnostics.ts';
import { HOSTS } from './hosts.ts';

/** What the server's reports and the relay's are scrubbed against. */
export const SCRUB: Scrub = { officeHosts: HOSTS, root: CODE, home: os.homedir() };

/** The owner's answer, read at send time from the setting the answer route writes. */
export const answer = (): Answer => answerFrom(process.env.OFFICE_DIAGNOSTICS);

/** The one consent check for everything the office sends. */
export const diagnosticsOn = (): boolean => answer() === 'yes';

/** For the page: whether reports can go at all (an address was found and the SDK started), and the answer. */
export const diagnosticsState = (): { possible: boolean; answer: Answer } => ({
  possible: !!getClient(),
  answer: answer()
});

/**
 * The door refuses bodies over 1 MiB, counted after gunzip. This leaves room
 * to spare. No cap on characters bounds the bytes, since JSON writes a
 * control character as 6, so the gate measures what it sends.
 */
export const DOOR_BODY_LIMIT = 1_000_000;

/**
 * Off by name. ProcessSession sends a session at the first request; Console
 * and LocalVariables carry what the office printed or held; LinkedErrors adds
 * each `cause` with its own free-text message (`keptMessage` reads a cause
 * itself where a shape needs it).
 */
const DROPPED: ReadonlySet<string> = new Set([
  'ProcessSession',
  'Console',
  'LocalVariables',
  'LocalVariablesAsync',
  'LinkedErrors'
]);

const bytes = (body: string | Uint8Array): number =>
  typeof body === 'string' ? Buffer.byteLength(body) : body.length;

type SpanContainer = { items: unknown[]; ingest_settings?: Record<string, unknown> };

/**
 * Each span container told never to infer the owner's address from the
 * request. The page's SDK says so itself; the server's sets no
 * `ingest_settings` at all, which leaves it to the door and Sentry.
 */
function neverInferIp(items: Envelope[1]): Envelope[1] {
  // A `span` item's payload is the SDK's span container.
  return items.map((item) => {
    if (item[0].type !== 'span') return item;
    const container = item[1] as SpanContainer;
    return [
      item[0],
      { ...container, ingest_settings: { ...container.ingest_settings, infer_ip: 'never' } }
    ];
  }) as Envelope[1];
}

function split(envelope: Envelope, dropped: { spans: number }): Envelope[] {
  const [header, [item]] = envelope;
  // An error report is never measured: it costs one serialization fewer.
  if (item?.[0].type !== 'span') return [envelope];
  if (bytes(serializeEnvelope(envelope)) <= DOOR_BODY_LIMIT) return [envelope];
  // A `span` item's payload is the SDK's span container.
  const container = item[1] as SpanContainer;
  const spans = container.items;
  if (spans.length <= 1) {
    dropped.spans += spans.length;
    return [];
  }
  const half = Math.ceil(spans.length / 2);
  // Each piece is the same envelope with part of its spans, so it keeps the type.
  return [spans.slice(0, half), spans.slice(half)].flatMap((part) =>
    split(
      [
        header,
        [
          [
            { ...item[0], item_count: part.length },
            { ...container, items: part }
          ]
        ]
      ] as Envelope,
      dropped
    )
  );
}

/**
 * The envelopes to send for one: a span envelope over the door's limit is
 * halved until each piece fits, and a single span that cannot fit is dropped
 * and counted. The SDK sends up to 1,000 spans at once and cannot be told fewer.
 */
export function fitDoor(envelope: Envelope): Envelope[] {
  const dropped = { spans: 0 };
  const pieces = split(envelope, dropped);
  if (dropped.spans)
    console.error(`[diagnostics] dropped ${dropped.spans} span(s) over the door's size limit`);
  return pieces;
}

type MakeTransport = typeof makeNodeTransport;

/**
 * The stock transport behind the owner's answer. Nothing leaves without yes,
 * asked on every send, so an answer takes effect with no restart. What does
 * leave gets a header from the allow list, span containers that infer no
 * address, and is cut to the door's size.
 */
export function gated(make: MakeTransport): MakeTransport {
  return (options) => {
    const inner = make(options);
    // The office's own key, which the door forwards under. The page's
    // envelopes carry a placeholder.
    const publicKey = new URL(options.url).searchParams.get('sentry_key') ?? '';
    const transport: Transport = {
      async send(envelope) {
        if (!diagnosticsOn()) return {};
        const header = scrubEnvelopeHeader(envelope[0], publicKey);
        let last = {};
        // Each part keeps its own type: `scrubEnvelopeHeader` and `neverInferIp` return the ones they get.
        for (const piece of fitDoor([header, neverInferIp(envelope[1])] as Envelope))
          last = await inner.send(piece);
        return last;
      },
      flush: (timeout) => inner.flush(timeout)
    };
    return transport;
  };
}

/**
 * The SDK's options, or undefined when no address is set: then the office
 * never starts the SDK, never asks the owner, and the relay drops what it
 * gets. `instrumentation.server.ts` runs before `.env` reaches
 * `process.env`, so the settings file is read here too.
 */
export function serverOptions(): NodeOptions | undefined {
  const dsn = process.env.ODDBORO_DIAGNOSTICS_DSN || readEnv().ODDBORO_DIAGNOSTICS_DSN;
  if (!dsn) return undefined;
  const version = process.env.ODDBORO_VERSION;
  return {
    dsn,
    release: version ? `oddboro@${version}` : undefined,
    environment: version ? 'production' : 'development',
    transport: gated(makeNodeTransport),
    tracesSampler: (ctx) => sampleTrace(ctx, answer()),
    // Each of these is on by default. Client reports keep a 60 s timer; the
    // server name is the computer's; trace headers would go to every site
    // the office fetches; breadcrumbs hold outgoing URLs and console lines.
    sendClientReports: false,
    includeServerName: false,
    tracePropagationTargets: [],
    dataCollection: DATA_COLLECTION,
    maxBreadcrumbs: 0,
    integrations: (defaults) => [
      ...defaults.filter((i) => !DROPPED.has(i.name)),
      httpIntegration({ sessions: false }),
      // The default only warns. Strict keeps today's crash on an unhandled
      // rejection, which the shell answers by restarting the office.
      onUnhandledRejectionIntegration({ mode: 'strict' })
    ],
    // Pinned against environment variables: SENTRY_SPOTLIGHT would post every
    // report around the gate, and SENTRY_TRACE_LIFECYCLE=static would send
    // transaction items, which `beforeSendSpan` never sees.
    spotlight: false,
    traceLifecycle: 'stream',
    beforeSend: (event, hint) => scrubEvent(event, { ...SCRUB, error: hint.originalException }),
    beforeSendSpan: scrubSpan
  };
}
