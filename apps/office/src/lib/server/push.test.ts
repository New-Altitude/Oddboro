// The buzz on the owner's phone (push.ts): the signed header, which addresses
// it sends to, and that it buzzes only for something new on the desk. The
// secret store, the desk and every push service are stand-ins, so nothing
// leaves this computer. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { mock, test } from 'node:test';
import type { Desk } from '@oddboro/ledger';

const store = new Map<string, string>();
/** How many times the stand-in store was read. */
const reads = { count: 0 };
const realSecrets = await import('@oddboro/ledger/secrets');
mock.module('@oddboro/ledger/secrets', {
  namedExports: {
    ...realSecrets,
    getSecret: (connector: string, name: string) => {
      reads.count++;
      return store.get(`${connector}:${name}`);
    },
    setSecret: (connector: string, name: string, value: string) =>
      store.set(`${connector}:${name}`, value),
    deleteSecret: (connector: string, name: string) => store.delete(`${connector}:${name}`)
  }
});

/** The desk as the stand-in ledger gives it: only the ids count here. */
let onDesk = { asks: [1], tasks: [] as number[], reports: [] as number[] };
const realLedger = await import('@oddboro/ledger');
mock.module('@oddboro/ledger', {
  namedExports: {
    ...realLedger,
    desk: async () =>
      ({
        asks: onDesk.asks.map((id) => ({ id })),
        tasks: onDesk.tasks.map((id) => ({ id })),
        reports: onDesk.reports.map((id) => ({ id }))
      }) as unknown as Desk
  }
});

/** Each push sent: where, and its headers. Each address answers as `answers` says, else 201. */
const sent: { address: string; headers: Record<string, string>; body: unknown }[] = [];
const answers = new Map<string, number>();
globalThis.fetch = (async (input: string, init: RequestInit) => {
  sent.push({
    address: input,
    headers: init.headers as Record<string, string>,
    body: init.body
  });
  return new Response(null, { status: answers.get(input) ?? 201 });
}) as typeof fetch;

const push = await import('./push.ts');

/** The store's one push name, `push-<hash of the home>`, once the key is made. */
const secretOf = (name: string) =>
  [...store.keys()].find((k) => k.startsWith('push-') && k.endsWith(`:${name}`));

const APPLE = 'https://web.push.apple.com/QGh1abc';
const GOOGLE = 'https://fcm.googleapis.com/fcm/send/xyz';

test('only https addresses at a known push service are taken', () => {
  for (const a of [
    APPLE,
    GOOGLE,
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc'
  ])
    assert.equal(push.isPushAddress(a), true, a);
  for (const a of [
    'http://web.push.apple.com/abc',
    'https://evil.example/web.push.apple.com',
    'https://web.push.apple.com.evil.example/abc',
    'https://user:pw@fcm.googleapis.com/abc',
    'https://127.0.0.1:4500/api/staff',
    'not an address'
  ])
    assert.equal(push.isPushAddress(a), false, a);
  assert.throws(() => push.addPhone('https://evil.example/push'));
  assert.deepEqual(push.phones(), []);
});

test("the header is signed with the office's key, for the push service's origin, by the project", () => {
  const key = push.publicKey();
  const header = push.vapidHeader(
    APPLE,
    JSON.parse(store.get(secretOf('vapid') ?? '') ?? '{}'),
    1_000_000
  );
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  const [, head, claims, signature, k] = m;
  assert.equal(k, key);
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), {
    aud: 'https://web.push.apple.com',
    exp: 1000 + 12 * 3600,
    sub: 'https://oddboro.com'
  });
  // The raw key the phone gets is the same key that checks the signature.
  const pub = createPublicKey({
    key: Buffer.concat([
      Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
      Buffer.from(key, 'base64url')
    ]),
    format: 'der',
    type: 'spki'
  });
  const ok = verify(
    'sha256',
    Buffer.from(`${head}.${claims}`),
    { key: pub, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url')
  );
  assert.equal(ok, true);
  // Asked again, the office keeps the same key.
  assert.equal(push.publicKey(), key);
});

test('a phone buzzes only for something new on the desk, and the push carries nothing', async () => {
  sent.length = 0;
  // Nothing buzzes while no phone is on.
  await push.deskChanged();
  assert.equal(sent.length, 0);
  push.addPhone(APPLE);
  // Turning it on sees the desk as it stands: no buzz for what is already there.
  await push.deskChanged();
  assert.equal(sent.length, 0);
  // A change that adds nothing new buzzes nothing either.
  onDesk = { asks: [], tasks: [], reports: [] };
  await push.deskChanged();
  assert.equal(sent.length, 0);
  onDesk = { asks: [], tasks: [7], reports: [] };
  await push.deskChanged();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].address, APPLE);
  assert.equal(sent[0].body, undefined);
  assert.equal(sent[0].headers.topic, 'desk');
  assert.match(sent[0].headers.authorization, /^vapid t=/);
  // The same desk again is nothing new.
  await push.deskChanged();
  assert.equal(sent.length, 1);
});

test('a phone its push service no longer knows is dropped, and turning one off keeps the rest', async () => {
  push.addPhone(GOOGLE);
  assert.deepEqual(push.phones(), [APPLE, GOOGLE]);
  answers.set(GOOGLE, 410);
  assert.equal(await push.buzz(), 1);
  assert.deepEqual(push.phones(), [APPLE]);
  // Any other refusal keeps the phone: the service may only be down.
  answers.set(APPLE, 500);
  assert.equal(await push.buzz(), 0);
  assert.deepEqual(push.phones(), [APPLE]);
  push.removePhone(APPLE);
  assert.deepEqual(push.phones(), []);
  assert.equal(secretOf('phones'), undefined);
});

test("the key and the phones are kept under this office's own home", () => {
  push.addPhone(APPLE);
  const name = secretOf('phones') ?? '';
  assert.match(name, /^push-[0-9a-f]{12}:phones$/);
  assert.equal(secretOf('vapid')?.split(':')[0], name.split(':')[0]);
  push.removePhone(APPLE);
});

test('a sent buzz says so in the log', async () => {
  const lines: string[] = [];
  const real = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    push.addPhone(APPLE);
    answers.delete(APPLE);
    await push.buzz();
  } finally {
    console.log = real;
    push.removePhone(APPLE);
  }
  assert.deepEqual(lines, ['[push] sent to 1 of 1 phone']);
});

test('with no phone on, a change to the desk reads neither the store nor the desk', async () => {
  push.phones();
  const before = reads.count;
  sent.length = 0;
  for (let i = 0; i < 5; i++) await push.deskChanged();
  assert.equal(reads.count, before);
  assert.equal(sent.length, 0);
});
