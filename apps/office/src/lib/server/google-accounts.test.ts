// More than one Google account. Each account is a connector of its own
// (`gmail`, `gmail-2`), found by `config.google`, never by its id. The owner
// adds one from an Odd's Services tab; a sign-in to an address another
// connector already holds is not kept, and Google is not told; revoking one
// leaves Google alone while another connector uses the same account; each
// account's tools name it; and a reply goes out with its own account's token.
// Google itself is a stand-in `fetch`. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { L, odd, secrets } from './office-under-test.ts';

process.env.ODDBORO_GOOGLE_CLIENT_SECRET = 'a-client-secret-for-tests';
const { startSignIn, finishSignIn } = await import('./oauth.ts');
const { listTools } = await import('./access.ts');
const { sendReply } = await import('./replies.ts');
const accessRoute = await import('../../routes/api/staff/[id]/access/+server.ts');

/** A stored Google sign-in with this access token. */
const signIn = (id: string, access: string) =>
  secrets.set(
    `${id}:oauth`,
    JSON.stringify({
      tokens: { access_token: access, refresh_token: `1//${access}`, expires_in: 3600 },
      savedAt: Date.now()
    })
  );

/** What reached Google: each address, its method and the token it carried. */
let google: { url: string; method: string; auth: string | null }[] = [];
/** The address Google says the next sign-in reaches. */
let signsInAs = 'ada@example.com';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith('accounts.google.com/.well-known/openid-configuration'))
    return Response.json({
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256']
    });
  if (url.startsWith('https://accounts.google.com/')) return new Response('', { status: 404 });
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  google.push({
    url,
    method: init.method ?? 'GET',
    auth: new Headers(init.headers).get('Authorization')
  });
  if (url === 'https://oauth2.googleapis.com/token')
    return Response.json({
      access_token: 'ya29.new-sign-in',
      refresh_token: '1//new-sign-in',
      expires_in: 3600,
      token_type: 'Bearer'
    });
  if (url.endsWith('/oauth2/v2/userinfo')) return Response.json({ email: signsInAs });
  if (url.endsWith('/users/me/profile')) return Response.json({ emailAddress: signsInAs });
  if (url.includes('/drive/v3/about')) return Response.json({ user: { emailAddress: signsInAs } });
  if (url.endsWith('/messages/send')) return Response.json({ id: 'm-sent', threadId: 't1' });
  return Response.json({});
}) as typeof fetch;

beforeEach(() => {
  google = [];
});

await L.pg`insert into staff ${L.pg([odd('wren', 'Wren'), odd('otto', 'Otto')])}`;
// Gmail is connected to Ada's account, for Wren.
signIn('gmail', 'ya29.ada-gmail');
await L.connectorReady('gmail', ['search_threads'], ['search_threads']);
await L.signedInAs('gmail', 'ada@example.com');
await L.grantAccess('wren', { connector: 'gmail', level: 'read' });

const grant = (body: unknown) =>
  accessRoute.POST({
    params: { id: 'wren' },
    request: new Request('http://office/api/staff/wren/access', {
      method: 'POST',
      body: JSON.stringify(body)
    })
  } as unknown as Parameters<typeof accessRoute.POST>[0]);
const openTasks = async (staffId: string) =>
  (await L.desk()).tasks.filter((t) => t.staffId === staffId);
/** The `state` a sign-in link carries back to the office. */
const stateOf = (url: string | undefined) => new URL(url!).searchParams.get('state')!;

test('a Google connector is found by its product: the scopes and the tools follow config.google, not the id', async () => {
  const added = await L.addGoogleAccount('drive');
  assert.equal(added.id, 'google-drive-2');
  const { url } = await startSignIn(added.id);
  assert.equal(new URL(url!).searchParams.get('scope'), 'https://www.googleapis.com/auth/drive');
  const tools = await listTools(added.id);
  assert.ok(tools.some((t) => t.name === 'search_files'));
});

test('the owner adds another Google account from the Services tab: a new connector, granted, with its connect task', async () => {
  const r = await grant({ connector: 'gmail', level: 'read', another: true });
  assert.deepEqual(await r.json(), { ok: true, task: true });
  const added = await L.connector('gmail-2');
  assert.equal(added?.name, 'Gmail');
  assert.deepEqual(added?.config, { oauth: 'google', google: 'gmail' });
  const held = (await L.grantsFor('wren')).map((g) => g.connectorId).sort();
  assert.deepEqual(held, ['gmail', 'gmail-2']);
  const [task] = (await openTasks('wren')).filter((t) =>
    t.steps.some((s) => s.action && 'connector' in s.action && s.action.connector === 'gmail-2')
  );
  assert.equal(task?.title, 'Connect another Gmail account for Wren');
});

test('a sign-in to an address another Gmail connector holds is not kept, and Google is not told', async () => {
  signsInAs = 'Ada@example.com';
  const { url } = await startSignIn('gmail-2');
  await assert.rejects(
    finishSignIn(stateOf(url), 'a-code'),
    /^Error: Ada@example\.com is already connected as Gmail \(ada@example\.com\)\. This sign-in was not kept\./
  );
  assert.equal(secrets.has('gmail-2:oauth'), false, 'the new sign-in left the store');
  assert.equal(secrets.has('gmail:oauth'), true, "the other connector's sign-in stays");
  assert.ok(!google.some((g) => g.url.includes('/revoke')), 'Google was not told');
  const c = await L.connector('gmail-2');
  assert.equal(c?.name, 'Gmail');
  assert.equal(c?.config.account, undefined);
  const step = (await openTasks('wren'))
    .flatMap((t) => t.steps)
    .find((s) => s.action?.kind === 'oauth' && s.action.connector === 'gmail-2');
  assert.match(
    step!.text,
    /^Ada@example\.com is already connected as Gmail \(ada@example\.com\)\./
  );
  assert.equal(step!.done, false);
});

test('a sign-in to a new address names the connector after it and keeps the address', async () => {
  signsInAs = 'bea@example.com';
  const { url } = await startSignIn('gmail-2');
  assert.equal(await finishSignIn(stateOf(url), 'a-code'), 'gmail-2');
  const c = await L.connector('gmail-2');
  assert.equal(c?.name, 'Gmail (bea@example.com)');
  assert.equal(c?.config.account, 'bea@example.com');
  const step = (await openTasks('wren'))
    .flatMap((t) => t.steps)
    .find((s) => s.action?.kind === 'oauth' && s.action.connector === 'gmail-2');
  assert.match(step!.text, /^Click Sign in\./, 'the step reads as it always does again');
  assert.equal(step!.done, true);
});

test("each Gmail account's tools name the account they reach", async () => {
  await L.connectorReady('gmail-2', ['search_threads'], ['search_threads']);
  const ada = await listTools('gmail');
  const bea = await listTools('gmail-2');
  const search = (tools: typeof ada) => tools.find((t) => t.name === 'search_threads')!;
  assert.match(search(ada).description, /It reaches the Gmail account ada@example\.com only\.$/);
  assert.match(search(bea).description, /It reaches the Gmail account bea@example\.com only\.$/);
  assert.ok(bea.every((t) => t.description.includes('bea@example.com')));
});

test("a reply goes out with its own account's token", async () => {
  const { ask } = await L.raiseAsk('wren', {
    kind: 'reply',
    title: 'Reply to Cy: Hello',
    why: 'Cy wrote to Bea.',
    ifApproved: 'You send it.',
    reply: {
      gmailThreadId: 't1',
      to: ['cy@example.com'],
      cc: [],
      subject: 'Re: Hello',
      body: 'Hi Cy.',
      summary: 'Cy says hello.',
      connector: 'gmail-2',
      account: 'bea@example.com'
    }
  });
  await sendReply(ask.id, 'send', {
    to: ['cy@example.com'],
    cc: [],
    subject: 'Re: Hello',
    body: 'Hi Cy.'
  });
  const sent = google.find((g) => g.url.endsWith('/messages/send'));
  assert.equal(sent?.auth, 'Bearer ya29.new-sign-in', "Bea's token, not Ada's");
  assert.equal((await L.ask(ask.id))?.status, 'approved');
});

test("revoking Gmail leaves the same account's Drive signed in at Google, and the ledger says so", async () => {
  signIn('google-drive', 'ya29.ada-drive');
  await L.signedInAs('google-drive', 'ada@example.com');
  await L.grantAccess('otto', { connector: 'google-drive', level: 'read' });
  await L.revoke('wren', 'gmail');
  assert.ok(!google.some((g) => g.url.includes('/revoke')), 'Google was not told');
  assert.equal(secrets.has('gmail:oauth'), false, 'Gmail left this computer');
  assert.equal(secrets.has('google-drive:oauth'), true, "Drive's sign-in stays");
  const gmail = await L.connector('gmail');
  assert.equal(gmail?.name, 'Gmail');
  assert.equal(gmail?.config.account, undefined);
  const [line] =
    await L.pg`select body from ledger where title = 'Revoked Gmail (ada@example.com) for Wren'`;
  assert.match(
    line.body,
    /Google keeps the sign-in, since Google Drive \(ada@example\.com\) uses the same Google account\. It came out of this computer only\./
  );

  // The last one on that account cancels it at Google.
  await L.revoke('otto', 'google-drive');
  assert.ok(google.some((g) => g.url === 'https://oauth2.googleapis.com/revoke'));
});

test('a further account no Odd holds any more leaves the catalog', async () => {
  await L.revoke('wren', 'gmail-2');
  assert.equal(await L.connector('gmail-2'), undefined);
  assert.ok(google.some((g) => g.url === 'https://oauth2.googleapis.com/revoke'));
});

test('Calendar keeps two sign-ins separate and revokes the one disconnected', async () => {
  const { connector } = await L.ensureConnector('google-calendar');
  assert.equal(connector?.config.google, 'calendar');
  await L.grantAccess('wren', { connector: 'google-calendar', level: 'read' });
  signsInAs = 'calendar-reader@example.com';
  const first = await startSignIn('google-calendar');
  assert.match(new URL(first.url!).searchParams.get('scope')!, /calendar\.readonly/);
  await finishSignIn(stateOf(first.url), 'test-code');
  assert.equal((await L.connector('google-calendar'))?.config.account, signsInAs);

  const other = await L.addGoogleAccount('calendar');
  await L.grantAccess('otto', { connector: other.id, level: 'read' });
  const duplicate = await startSignIn(other.id);
  await assert.rejects(finishSignIn(stateOf(duplicate.url), 'test-code'), /already connected/);
  signsInAs = 'second-calendar@example.com';
  const second = await startSignIn(other.id);
  await finishSignIn(stateOf(second.url), 'test-code');
  assert.ok((await listTools(other.id)).every((tool) => tool.description.includes(signsInAs)));

  await L.revoke('wren', 'google-calendar');
  assert.ok(google.some((call) => call.url.endsWith('/revoke')));
  assert.ok(secrets.has(other.id + ':oauth'));
  await L.revoke('otto', other.id);
});
