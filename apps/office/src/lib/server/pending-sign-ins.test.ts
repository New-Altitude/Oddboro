import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const secrets = new Map<string, string>();
mock.module('./keychain.ts', {
  namedExports: {
    getSecret: (id: string, key: string) => secrets.get(`${id}:${key}`),
    setSecret: (id: string, key: string, value: string) => secrets.set(`${id}:${key}`, value)
  }
});
const { PendingSignIns } = await import('./pending-sign-ins.ts');
test('closing the browser or restarting loses no pending state, and claiming survives another restart', () => {
  new PendingSignIns().set('random-state', 'new-altitude-persona-pat');
  const restarted = new PendingSignIns();
  assert.equal(restarted.get('random-state'), 'new-altitude-persona-pat');
  assert.equal(restarted.delete('random-state'), true);
  assert.equal(new PendingSignIns().get('random-state'), undefined);
});
test('expired or malformed states cannot finish', () => {
  secrets.set(
    'new-altitude-account:pending',
    JSON.stringify({ old: { id: 'account', until: Date.now() - 1 } })
  );
  assert.equal(new PendingSignIns().get('old'), undefined);
  secrets.set('new-altitude-account:pending', 'not JSON');
  assert.equal(new PendingSignIns().get('old'), undefined);
});
