// A source build whose owner set their own address in the settings file, not
// the environment: reports go straight there, under their own key. The
// settings file and home are temp, and nothing here queries the database.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { recorder, sender, tempOffice, throwing, until } from './diagnostics-harness.ts';

const door = await recorder();
// `tempOffice` deletes the address from the environment, so only the file names it.
const { folder, settings } = tempOffice('diagnostics-own');
writeFileSync(
  settings,
  `ODDBORO_DIAGNOSTICS_DSN=http://ownkey@127.0.0.1:${door.port}/42\nOFFICE_DIAGNOSTICS=yes\n`
);

await import('../../instrumentation.server.ts');
const Sentry = await import('@sentry/sveltekit');
const hooks = await import('../../hooks.server.ts');
const { diagnosticsState } = await import('./diagnostics.ts');

after(() => {
  door.close();
  rmSync(folder, { recursive: true, force: true });
});

test('the page is told whether reports need a sign-in', () => {
  assert.equal(diagnosticsState().account, false);
});

test("a report to the owner's own Sentry needs no sign-in and carries no token", async () => {
  // No account site is set and nothing here signs in.
  assert.equal(process.env.ODDBORO_ACCOUNT_SITE, undefined);
  const from = door.got.length;
  await sender(hooks.handle)({
    route: '/api/goals',
    resolve: throwing(() => new Error('own address, signed out'))
  });
  await Sentry.flush(5000);
  await until(() => door.got.length > from);
  assert.ok(door.got.length > from);
  for (const g of door.got.slice(from)) assert.equal(g.headers.authorization, undefined);
});

test('with its own address in the settings file, a source build sends straight there', async () => {
  await sender(hooks.handle)({
    route: '/api/goals',
    resolve: throwing(() => new Error('T10 own address'))
  });
  await Sentry.flush(5000);
  await until(() => door.got.length > 0);
  const url = new URL(door.got[0].url, 'http://door');
  assert.equal(url.pathname, '/api/42/envelope/');
  assert.equal(url.searchParams.get('sentry_key'), 'ownkey');
});
