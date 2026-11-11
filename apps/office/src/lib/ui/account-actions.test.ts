// Switch account: the page signs the office out, then starts a new sign-in,
// and anything short of a finished sign-in leaves it signed out. The page's
// account object is a plain one here; fetch answers as the office's
// /api/account does. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { beforeEach, mock, test, type TestContext } from 'node:test';
import type { AccountStatus } from '#lib/account.ts';

const account: { status: AccountStatus } = { status: { state: 'out' } };
mock.module('./account.svelte.ts', { namedExports: { account } });
const { switchAccount } = await import('./account-actions.ts');

const signedIn: AccountStatus = {
  state: 'in',
  account: { id: 'member-1', name: 'Ada Member', email: 'ada@example.test' }
};
beforeEach(() => {
  account.status = signedIn;
});

/** Answer `/api/account` as the office does, failing the methods in `fail`; returns the methods sent, in order. */
function office(t: TestContext, fail: string[] = []): string[] {
  const sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    sent.push(method);
    if (fail.includes(method))
      return Response.json({ message: `${method} refused` }, { status: 502 });
    if (method === 'DELETE') return Response.json({ status: { state: 'out' } });
    return Response.json({ url: 'https://members.example.test/authorize?x=1' });
  });
  return sent;
}

test('switching signs out first, then starts a new sign-in and answers its page', async (t) => {
  const sent = office(t);
  assert.equal(await switchAccount(), 'https://members.example.test/authorize?x=1');
  assert.deepEqual(sent, ['DELETE', 'POST']);
  assert.deepEqual(account.status, { state: 'out' });
});

test('a new sign-in that fails to start leaves the office signed out', async (t) => {
  const sent = office(t, ['POST']);
  await assert.rejects(switchAccount(), { message: 'POST refused' });
  assert.deepEqual(sent, ['DELETE', 'POST']);
  assert.deepEqual(account.status, { state: 'out' });
});

test('a sign-out that fails starts no new sign-in and keeps the account shown', async (t) => {
  const sent = office(t, ['DELETE']);
  await assert.rejects(switchAccount(), { message: 'DELETE refused' });
  assert.deepEqual(sent, ['DELETE']);
  assert.deepEqual(account.status, signedIn);
});
