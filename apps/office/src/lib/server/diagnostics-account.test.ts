// Reports to New Altitude need the owner's New Altitude sign-in: none leaves
// while signed out, and each one that leaves carries the account's access
// token in its `authorization` header. A fake New Altitude
// (`fake-new-altitude.ts`) is the account site, and a fake door on the same
// host records every report, so the office treats the door as New Altitude's.
// The secret store is a Map; the settings file and home are temp. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { after, mock, test } from 'node:test';
import { fakeNewAltitude } from './fake-new-altitude.ts';
import {
  ENVELOPE_PATH,
  ofType,
  PAGE,
  recorder,
  sender,
  tempOffice,
  throwing,
  traceHeader,
  until,
  type Route
} from './diagnostics-harness.ts';

/** The one secret that holds the sign-in. */
const SIGN_IN = 'new-altitude-account:oauth';
const store = new Map<string, string>();
let signInReads = 0;
// The real module's other exports too, such as `useShellSecrets`, which the
// office's server hooks import.
const realSecrets = await import('@oddboro/ledger/secrets');
mock.module('@oddboro/ledger/secrets', {
  namedExports: {
    ...realSecrets,
    getSecret: (connector: string, name: string) => {
      const key = `${connector}:${name}`;
      if (key === SIGN_IN) signInReads++;
      return store.get(key);
    },
    setSecret: (connector: string, name: string, value: string) =>
      void store.set(`${connector}:${name}`, value),
    deleteSecret: (connector: string, name: string) => store.delete(`${connector}:${name}`),
    secretStore: () => ({ ok: true })
  }
});

const door = await recorder();
const fake = await fakeNewAltitude();
const { folder } = tempOffice('diagnostics-account');
// The page's own origin in the harness is port 4500, so the office's must be too.
delete process.env.ODDBORO_PORT;
Object.assign(process.env, {
  ODDBORO_DIAGNOSTICS_DSN: `http://oddboro@127.0.0.1:${door.port}/oddboro/0`,
  ODDBORO_ACCOUNT_SITE: fake.origin
});

await import('../../instrumentation.server.ts');
const Sentry = await import('@sentry/sveltekit');
const { fixedError } = await import('@oddboro/ledger/errors');
const hooks = await import('../../hooks.server.ts');
const answerRoute = await import('../../routes/api/diagnostics/+server.ts');
const relayRoute = await import('../../routes/api/diagnostics/envelope/+server.ts');
const accountRoute = await import('../../routes/api/account/+server.ts');
const account = await import('./account.ts');
const { diagnosticsState, TOKEN_REUSE_MS } = await import('./diagnostics.ts');
const { MARGIN_MS } = await import('./oauth.ts');

after(async () => {
  door.close();
  await fake.close();
  rmSync(folder, { recursive: true, force: true });
});

const send = sender(hooks.handle);
const flush = () => Sentry.flush(5000);
const atDoor = (from = 0) => door.got.slice(from).filter((g) => g.url.startsWith(ENVELOPE_PATH));
const arrived = (mark: string, from = 0) => atDoor(from).some((g) => g.body.includes(mark));

/**
 * A server error whose message is kept, so the door's copy can be found by it.
 * Made here, not at each call: a report carries the source lines around where
 * its error was made, and a caller's lines hold the marks of the reports beside it.
 */
const fail = (mark: string, headers: Record<string, string> = {}) =>
  // `fixedError` takes only a literal type; each mark is one the test wrote.
  send({ route: '/api/goals', headers, resolve: throwing(() => fixedError(mark as 'mark')) });

/** Sign in through the fake, as the owner's page and New Altitude's sign-in page do. */
async function signIn(): Promise<void> {
  const { url } = await account.startAccountSignIn();
  const res = await fetch(url, { redirect: 'manual' });
  const back = new URL(res.headers.get('location') ?? '');
  const state = back.searchParams.get('state') ?? '';
  await account.finishAccountSignIn(state, back.searchParams.get('code') ?? '');
  assert.equal(account.accountStatus().state, 'in');
}

/** The access token the sign-in holds now, as the secret store keeps it. */
const heldToken = (): string =>
  (JSON.parse(store.get(SIGN_IN) ?? '{}') as { tokens?: { access_token?: string } }).tokens
    ?.access_token ?? '';

const signOut = () =>
  send({
    route: '/api/account',
    method: 'DELETE',
    headers: PAGE,
    resolve: accountRoute.DELETE as Route
  });

test('the page is told whether reports need a sign-in', () => {
  assert.equal(diagnosticsState().account, true);
});

test('signed out, a report to New Altitude is not sent; signed in, it is', async () => {
  const yes = await send({
    route: '/api/diagnostics',
    method: 'PUT',
    headers: { ...PAGE, 'content-type': 'application/json' },
    body: '{"answer":"yes"}',
    resolve: answerRoute.PUT as Route
  });
  assert.equal(yes.status, 200);

  await fail('gate, signed out');
  await flush();
  assert.equal(atDoor().length, 0);

  await signIn();
  await fail('gate, signed in');
  await flush();
  await until(() => arrived('gate, signed in'));
  assert.ok(arrived('gate, signed in'));
  assert.ok(!arrived('gate, signed out'), 'the report from before the sign-in went later');
});

test("every report to New Altitude carries the account's access token, and no body does", async () => {
  const from = door.got.length;
  // A traced request that fails: an error and its spans.
  await fail('with a token, from the server', { 'sentry-trace': traceHeader() });
  // The page's own error, through the relay.
  const id = randomBytes(16).toString('hex');
  const pageReport = [
    { event_id: id, sent_at: new Date().toISOString(), dsn: 'http://page@127.0.0.1/0' },
    { type: 'event' },
    { event_id: id, platform: 'javascript', message: 'with a token, from the page' }
  ];
  const relayed = await send({
    route: '/api/diagnostics/envelope',
    method: 'POST',
    headers: { ...PAGE, 'content-type': 'application/x-sentry-envelope' },
    body: pageReport.map((x) => JSON.stringify(x)).join('\n'),
    resolve: relayRoute.POST as Route
  });
  assert.equal(relayed.status, 200);
  await flush();
  const got = () => atDoor(from);
  const pageEvent = () => got().some((g) => g.body.includes(id));
  await until(
    () =>
      arrived('with a token, from the server', from) &&
      pageEvent() &&
      ofType(got(), 'span').length > 0
  );
  assert.ok(arrived('with a token, from the server', from));
  assert.ok(pageEvent());
  assert.ok(ofType(got(), 'span').length > 0);

  const token = heldToken();
  assert.match(token, /^access-\d+$/);
  for (const g of got()) {
    assert.equal(g.headers.authorization, `Bearer ${token}`);
    assert.ok(!`${g.url} ${g.body}`.includes('access-'), 'a token in the address or the body');
  }
});

test('signing out stops reports at once', async () => {
  await fail('sign-out, before');
  await flush();
  await until(() => arrived('sign-out, before'));
  assert.ok(arrived('sign-out, before'));

  assert.equal((await signOut()).status, 200);
  await fail('sign-out, after');
  await flush();
  await signIn();
  await fail('sign-out, signed in again');
  await flush();
  await until(() => arrived('sign-out, signed in again'));
  assert.ok(arrived('sign-out, signed in again'));
  assert.ok(!arrived('sign-out, after'), 'a report left while signed out');
});

test('signing out and in again never reuses the old sign-in token', async () => {
  // Signed in from the last test, with a token reused since.
  const before = heldToken();
  await signOut();
  await signIn();
  const now = heldToken();
  assert.notEqual(now, before);
  const from = door.got.length;
  await fail('new sign-in');
  await flush();
  await until(() => arrived('new sign-in', from));
  assert.ok(arrived('new sign-in', from));
  for (const g of atDoor(from)) assert.equal(g.headers.authorization, `Bearer ${now}`);
});

test('reports within four minutes read the secret store once', async () => {
  const from = door.got.length;
  await fail('reuse, first');
  await flush();
  await until(() => arrived('reuse, first', from));
  const afterFirst = signInReads;
  for (let i = 2; i <= 5; i++) await fail(`reuse, send ${i}`);
  await flush();
  await until(() => arrived('reuse, send 5', from));
  assert.equal(atDoor(from).length, 5);
  for (const g of atDoor(from)) assert.match(g.headers.authorization ?? '', /^Bearer access-\d+$/);
  assert.equal(signInReads, afterFirst, 'a later report read the secret store');
});

// Bounded: when no refresh starts, the held `/token` never answers, and the
// test would wait forever instead of failing.
test(
  'a report waiting on a token refresh reaches the door before flush returns',
  { timeout: 10_000 },
  async () => {
    // Tokens that end within the refresh margin, so the next report refreshes first.
    fake.expiresIn = 60;
    await signOut();
    await signIn();
    const refresh = fake.hold('/token');
    const from = door.got.length;
    await fail('flush, after a refresh');
    const flushed = flush();
    (await refresh)();
    await flushed;
    fake.expiresIn = 3600;
    assert.ok(arrived('flush, after a refresh', from));
  }
);

test('the reuse window is under the refresh margin', () => {
  assert.ok(TOKEN_REUSE_MS < MARGIN_MS);
});
