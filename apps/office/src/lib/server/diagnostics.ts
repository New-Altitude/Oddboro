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
import {
  makePromiseBuffer,
  serializeEnvelope,
  type Envelope,
  type Transport,
  type TransportMakeRequestResponse
} from '@sentry/core';
import { readEnv } from '@oddboro/ledger/env';
import { CODE } from '@oddboro/ledger/home';
import {
  answerFrom,
  DATA_COLLECTION,
  needsSignIn,
  sampleTrace,
  scrubEnvelopeHeader,
  scrubEvent,
  scrubSpan,
  type Answer,
  type ReportsState,
  type Scrub
} from '#lib/diagnostics.ts';
import type { AccountStatus } from '#lib/account.ts';
import { HOSTS } from './hosts.ts';

/** What the server's reports and the relay's are scrubbed against. */
export const SCRUB: Scrub = { officeHosts: HOSTS, root: CODE, home: os.homedir() };

/** The owner's answer, read at send time from the setting the answer route writes. */
export const answer = (): Answer => answerFrom(process.env.OFFICE_DIAGNOSTICS);

/** The one consent check for everything the office sends. */
export const diagnosticsOn = (): boolean => answer() === 'yes';

/**
 * The New Altitude site set for development and tests, read as the address
 * is: the transport is made before the settings file reaches `process.env`.
 */
const accountSite = () => process.env.ODDBORO_ACCOUNT_SITE || readEnv().ODDBORO_ACCOUNT_SITE;

/**
 * For the page: whether reports can go at all (an address was found and the
 * SDK started), whether they need a New Altitude sign-in, and the answer.
 */
export const diagnosticsState = (): ReportsState => ({
  possible: !!getClient(),
  account: needsSignIn({ address: getClient()?.getOptions().dsn, accountSite: accountSite() }),
  answer: answer()
});

/**
 * How long reports reuse the account's token before asking the secret store
 * again. Under the refresh margin in `oauth.ts`, so a reused token still has
 * at least a minute left.
 */
export const TOKEN_REUSE_MS = 4 * 60_000;

let reused: { token: string; signIn: AccountStatus; at: number } | undefined;

/**
 * The account's token for a report, or undefined while signed out. Loaded at
 * send time, never at the top: `account.ts` brings in Postgres, which this
 * module must not (see the top of this file). Reused only within one sign-in:
 * `accountStatus()` gives a new status at each sign-in and sign-out, so after
 * signing out and in again, or Switch account, no report goes with the old
 * token, even for the same account.
 */
async function reportToken(): Promise<string | undefined> {
  const account = await import('./account.ts');
  const signIn = account.accountStatus();
  if (signIn.state !== 'in') {
    reused = undefined;
    return undefined;
  }
  if (reused?.signIn === signIn && Date.now() - reused.at < TOKEN_REUSE_MS) return reused.token;
  const token = await account.accountToken();
  reused = token ? { token, signIn, at: Date.now() } : undefined;
  return token;
}

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
 * asked on every send, so an answer takes effect with no restart. Reports to
 * an address that needs a New Altitude sign-in go only while signed in, each
 * with the account's token. What does leave gets a header from the allow
 * list, span containers that infer no address, and is cut to the door's size.
 */
export function gated(make: MakeTransport): MakeTransport {
  return (options) => {
    // `options.url` is the envelope address, with the DSN's scheme and host.
    const signIn = needsSignIn({ address: options.url, accountSite: accountSite() });
    const plain = signIn ? undefined : make(options);
    // The stock transport takes its headers when it is made, so one is made per token.
    let signed: { token: string; transport: Transport } | undefined;
    const innerFor = async (): Promise<Transport | undefined> => {
      if (plain) return plain;
      const token = await reportToken();
      if (!token) return undefined;
      if (signed?.token !== token) {
        const headers = { ...options.headers, authorization: `Bearer ${token}` };
        signed = { token, transport: make({ ...options, headers }) };
      }
      return signed.transport;
    };
    // The office's own key, which the door forwards under. The page's
    // envelopes carry a placeholder.
    const publicKey = new URL(options.url).searchParams.get('sentry_key') ?? '';
    const deliver = async (envelope: Envelope): Promise<TransportMakeRequestResponse> => {
      if (!diagnosticsOn()) return {};
      const inner = await innerFor();
      if (!inner) return {};
      const header = scrubEnvelopeHeader(envelope[0], publicKey);
      let last = {};
      // Each part keeps its own type: `scrubEnvelopeHeader` and `neverInferIp` return the ones they get.
      for (const piece of fitDoor([header, neverInferIp(envelope[1])] as Envelope))
        last = await inner.send(piece);
      return last;
    };
    // Every send from its start: one waiting on the token is not yet in the
    // stock transport, whose own flush would miss it, and the SDK flushes
    // before a crash ends the office. Each send waits for its requests, so
    // this is all `flush` has to wait for.
    const sending = makePromiseBuffer<TransportMakeRequestResponse>();
    const transport: Transport = {
      send: (envelope) => sending.add(() => deliver(envelope)),
      flush: (timeout) => sending.drain(timeout)
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
