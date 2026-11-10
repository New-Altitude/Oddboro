// The New Altitude sign-in with reports on: a whole sign-in, traced, against
// a fake New Altitude (`fake-new-altitude.ts`), and a fake door that records every
// report. The door must get the sign-in's spans, and none of its secrets but
// the access token, which goes only in the `authorization` header. The
// secret store is a Map; the settings file and home are temp. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, mock, test } from 'node:test';
import type { RequestEvent } from '@sveltejs/kit';
import { fakeNewAltitude, MEMBER } from './fake-new-altitude.ts';
import {
  ENVELOPE_PATH,
  ofType,
  PAGE,
  recorder,
  sender,
  tempOffice,
  traceHeader,
  until,
  type Route
} from './diagnostics-harness.ts';

const store = new Map<string, string>();
// The real module's other exports too, such as `useShellSecrets`, which the
// office's server hooks import.
const realSecrets = await import('@oddboro/ledger/secrets');
mock.module('@oddboro/ledger/secrets', {
  namedExports: {
    ...realSecrets,
    getSecret: (connector: string, name: string) => store.get(`${connector}:${name}`),
    setSecret: (connector: string, name: string, value: string) =>
      void store.set(`${connector}:${name}`, value),
    deleteSecret: (connector: string, name: string) => store.delete(`${connector}:${name}`),
    secretStore: () => ({ ok: true })
  }
});

const door = await recorder();
const fake = await fakeNewAltitude();
const { folder } = tempOffice('account-reports');
// The page's own origin in the harness is port 4500, so the office's must be too.
delete process.env.ODDBORO_PORT;
Object.assign(process.env, {
  ODDBORO_DIAGNOSTICS_DSN: `http://oddboro@127.0.0.1:${door.port}/oddboro/0`,
  ODDBORO_ACCOUNT_SITE: fake.origin
});

await import('../../instrumentation.server.ts');
const Sentry = await import('@sentry/sveltekit');
const hooks = await import('../../hooks.server.ts');
const answerRoute = await import('../../routes/api/diagnostics/+server.ts');
const accountRoute = await import('../../routes/api/account/+server.ts');
const callback = await import('../../routes/account/callback/+page.server.ts');

after(async () => {
  door.close();
  await fake.close();
  rmSync(folder, { recursive: true, force: true });
});

const send = sender(hooks.handle);

test('a sign-in leaves no token, code, state or email in any error or trace report', async () => {
  const yes = await send({
    route: '/api/diagnostics',
    method: 'PUT',
    headers: { ...PAGE, 'content-type': 'application/json' },
    body: '{"answer":"yes"}',
    resolve: answerRoute.PUT as Route
  });
  assert.equal(yes.status, 200);

  // Sign in, traced.
  let url = '';
  await send({
    route: '/api/account',
    method: 'POST',
    headers: { ...PAGE, 'sentry-trace': traceHeader() },
    resolve: async (e) => {
      const res = await (accountRoute.POST as Route)(e as RequestEvent);
      url = ((await res.clone().json()) as { url: string }).url;
      return res;
    }
  });
  assert.ok(url);

  // New Altitude's sign-in page sends the browser back with a code.
  const res = await fetch(url, { redirect: 'manual' });
  const back = new URL(res.headers.get('location') ?? '');
  const code = back.searchParams.get('code') ?? '';
  const state = back.searchParams.get('state') ?? '';
  assert.ok(code && state);

  // The callback page, traced.
  let title = '';
  await send({
    route: '/account/callback',
    path: `${back.pathname}${back.search}`,
    headers: { 'sentry-trace': traceHeader() },
    resolve: async (e) => {
      const data = (await callback.load(e as Parameters<typeof callback.load>[0])) as {
        title: string;
      };
      title = data.title;
      return new Response(title);
    }
  });
  assert.equal(title, 'Signed in');

  const traded = fake.seen.find((s) => s.path === '/token');
  const verifier = new URLSearchParams(traded?.body).get('code_verifier') ?? '';
  assert.ok(verifier);

  await Sentry.flush(5000);
  const atDoor = () => door.got.filter((g) => g.url.startsWith(ENVELOPE_PATH));
  const names = () =>
    ofType(atDoor(), 'span').flatMap(([, p]) =>
      (p as { items: { name: string }[] }).items.map((s) => s.name)
    );
  await until(() => names().includes('GET /account/callback'));
  // The positive control: the door got the callback's span.
  assert.ok(names().includes('GET /account/callback'), names().join(', '));

  // The reports need the sign-in, so each carries its access token in the one header for it.
  for (const g of door.got) assert.match(g.headers.authorization ?? '', /^Bearer access-\d+$/);
  const sent = door.got
    .map((g) => `${g.url} ${JSON.stringify({ ...g.headers, authorization: undefined })} ${g.body}`)
    .join('\n');
  for (const secret of [code, state, verifier, MEMBER.email, MEMBER.name])
    assert.ok(!sent.includes(secret), `the door got ${secret}`);
  assert.doesNotMatch(sent, /\b(access|refresh)-\d/);
});
