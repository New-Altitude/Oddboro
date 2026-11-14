// Publications arrive at the members site, never at the persona's chat door.
import { setTimeout as delay } from 'node:timers/promises';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { z } from 'zod';
import {
  personaOdd,
  followedPublications,
  receivePublications,
  setPublicationMode,
  stopPublicationFollows,
  type PublicationMode
} from '@oddboro/ledger';
import { accountStatus, accountSite, accountHasPersonas, accountToken } from './account.ts';
import { notifyMac } from './notify.ts';
import { bus, emit, listen as listenForOfficeChanges } from './events.ts';

const seq = z.number().int().nonnegative().safe();
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u);
const link = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .refine((v) => {
    const u = new URL(v);
    return !u.username && !u.password;
  });
const item = z.object({
  sequence: seq.positive(),
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  id: line(200),
  revision: z.number().int().positive().max(2147483647),
  action: z.enum(['published', 'corrected', 'withdrawn']),
  kind: z.enum(['article', 'video']),
  title: line(300),
  url: link,
  publishedAt: z.iso.datetime({ offset: true })
});
const batch = z
  .object({ through: seq, phase: z.enum(['catch-up', 'live']), events: z.array(item).max(100) })
  .refine((b) =>
    b.events.every(
      (e, i) => e.sequence <= b.through && (!i || e.sequence > b.events[i - 1].sequence)
    )
  );
const endpoint = () => `${accountSite()}/api/personas/publications`;
const account = () => {
  const a = accountStatus();
  return a.state === 'in' && accountHasPersonas()
    ? JSON.stringify([accountSite(), a.account.id])
    : undefined;
};
let offers = new Set<string>();
let heardFor: string | undefined;
let key = '';
let connection: AbortController | undefined;
let problem = '';
let generation = 0;
let listening = false;
let settings: Promise<unknown> = Promise.resolve();
function status(text: string) {
  if (problem === text) return;
  problem = text;
  emit({ type: 'publication-settings' });
}
function stop() {
  connection?.abort();
  connection = undefined;
  key = '';
  status('');
}

/** Only an advertised version enables a new follow. A transport failure is not a revocation. */
export function publicationsOffered(slugs: string[] | undefined) {
  const next = new Set(slugs);
  const changed =
    heardFor !== account() ||
    offers.size !== next.size ||
    [...next].some((slug) => !offers.has(slug));
  heardFor = account();
  offers = next;
  if (changed) emit({ type: 'publication-settings' });
  if (!listening) {
    listening = true;
    bus.on('event', (e) => {
      if (e.type === 'account') {
        stop();
        heardFor = undefined;
        offers.clear();
      }
      if (e.type === 'account' || (e.type === 'change' && e.table === 'staff'))
        void refreshPublications();
    });
  }
  void refreshPublications();
}
export async function signOutPublications() {
  const a = account();
  ++generation;
  stop();
  heardFor = undefined;
  offers.clear();
  if (a) await stopPublicationFollows(a);
}
export async function publicationSetting(slug: string) {
  const a = account();
  const follow = a && (await followedPublications(a)).find((f) => f.slug === slug);
  return {
    available: !!a && heardFor === a && offers.has(slug),
    mode: follow ? follow.mode : ('off' as const),
    problem: follow ? problem : ''
  };
}

/** Serialize rapid changes, so an older head request cannot turn a newer Off back on. */
export function changePublications(slug: string, mode: PublicationMode) {
  const a = account();
  const operation = settings.then(async () => {
    const who = await personaOdd(slug);
    if (!who || !a || account() !== a) throw new Error('Reconnect this persona first.');
    let head = 0;
    if (mode !== 'off') {
      if (heardFor !== a || !offers.has(slug) || who.package?.quiet)
        throw new Error('This persona does not offer publication updates.');
      if (!(await followedPublications(a)).some((f) => f.slug === slug)) {
        const token = await accountToken();
        if (!token || account() !== a) throw new Error('Sign in to New Altitude again.');
        const res = await fetch(endpoint() + '?head=1', {
          headers: { authorization: `Bearer ${token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok)
          throw new Error('New Altitude did not return the current publication position.');
        head = z.object({ through: seq }).parse(await res.json()).through;
      }
    }
    if (account() !== a || (mode !== 'off' && (heardFor !== a || !offers.has(slug))))
      throw new Error('The persona connection changed.');
    await setPublicationMode(who.id, a, mode, head);
    stop();
    await refreshPublications();
    emit({ type: 'publication-settings' });
    return publicationSetting(slug);
  });
  settings = operation.catch(() => {});
  return operation;
}

export async function refreshPublications() {
  const turn = ++generation;
  try {
    const a = account();
    if (!a || heardFor !== a) {
      stop();
      return;
    }
    const subs = (await followedPublications(a)).filter((s) => offers.has(s.slug));
    if (turn !== generation) return;
    const slugs = subs.map((s) => s.slug).sort();
    const next = JSON.stringify([a, slugs]);
    if (!subs.length) {
      stop();
      return;
    }
    if (next === key) return;
    stop();
    listenForOfficeChanges();
    key = next;
    const c = (connection = new AbortController());
    void listen(a, slugs, c.signal).catch(() => {
      if (!c.signal.aborted)
        status('Publication updates stopped. Turn updates off and on to reconnect.');
    });
  } catch {
    if (turn === generation) {
      stop();
      status('Publication settings could not be loaded.');
    }
  }
}
async function listen(a: string, slugs: string[], signal: AbortSignal) {
  const current = () => !signal.aborted && account() === a;
  let wait = 1000;
  while (current()) {
    try {
      const subs = (await followedPublications(a)).filter((s) => slugs.includes(s.slug));
      if (!subs.length || !current()) return;
      const after = Math.min(...subs.map((s) => Number(s.position)));
      const token = await accountToken();
      if (!current()) return;
      if (!token) throw new Error('Sign-in unavailable');
      const url = new URL(endpoint() + '/events');
      url.searchParams.set('after', String(after));
      for (const slug of slugs) url.searchParams.append('slug', slug);
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
        redirect: 'error',
        signal
      });
      if ([401, 403, 410].includes(res.status)) {
        status(
          res.status === 410
            ? 'The saved feed position expired. Turn updates off and on to start from now.'
            : 'Publication access ended. Reconnect this persona.'
        );
        await res.body?.cancel();
        return;
      }
      if (
        !res.ok ||
        !res.body ||
        !res.headers.get('content-type')?.startsWith('text/event-stream')
      ) {
        await res.body?.cancel();
        throw new Error('Feed unavailable');
      }
      let catchup = 0;
      let position = after;
      status('');
      const reader = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream({ onError: 'terminate', maxBufferSize: 512000 }))
        .getReader();
      try {
        while (current()) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.event !== 'publications') continue;
          const b = batch.parse(JSON.parse(value.data));
          if (b.through < position) throw new Error('Publication position went backwards');
          const alerts = await receivePublications(a, b.events, b.through, slugs, current);
          position = b.through;
          if (!current()) return;
          status('');
          wait = 1000;
          if (b.phase === 'catch-up') catchup += alerts.length;
          else {
            if (catchup) {
              void notifyMac('New publications', `${catchup} new in your persona chats.`);
              catchup = 0;
            }
            for (const alert of alerts) void notifyMac(alert.name, alert.title);
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      if (!current()) return;
    }
    if (!current()) return;
    status('Publication updates are interrupted. The office will reconnect.');
    await delay(wait, undefined, { signal, ref: false });
    wait = Math.min(wait * 2, 60000);
  }
}
