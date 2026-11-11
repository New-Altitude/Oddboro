// A release: reports go to New Altitude's own address and no account site is
// set, so the office decides from the address alone that they need a sign-in.
// The SDK runs with the office's own options, but the gate wraps a fake that
// counts what it is given in place of the stock transport, so nothing here
// reaches the network. The secret store is empty, so the office is signed
// out. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, mock, test } from 'node:test';
import type { Transport } from '@sentry/core';
import { tempOffice } from './diagnostics-harness.ts';

let signInReads = 0;
// The real module's other exports too, such as `useShellSecrets`, which the
// office's server hooks import.
const realSecrets = await import('@oddboro/ledger/secrets');
mock.module('@oddboro/ledger/secrets', {
  namedExports: {
    ...realSecrets,
    getSecret: (connector: string, name: string) => {
      if (`${connector}:${name}` === 'new-altitude-account:oauth') signInReads++;
      return undefined;
    },
    setSecret: () => undefined,
    deleteSecret: () => false,
    secretStore: () => ({ ok: true })
  }
});

const { folder } = tempOffice('diagnostics-new-altitude');
delete process.env.ODDBORO_ACCOUNT_SITE;
Object.assign(process.env, {
  ODDBORO_DIAGNOSTICS_DSN: 'https://oddboro@relay.newaltitude.ai/oddboro/0',
  OFFICE_DIAGNOSTICS: 'yes'
});

const Sentry = await import('@sentry/sveltekit');
const { diagnosticsState, gated, serverOptions } = await import('./diagnostics.ts');

/** The envelope address each transport behind the gate was made for. */
const made: string[] = [];
/** How many envelopes passed the gate. */
let sent = 0;
const options = serverOptions();
assert.ok(options, 'no options for the address');
Sentry.init({
  ...options,
  transport: gated((o): Transport => {
    made.push(o.url);
    return {
      send: async () => {
        sent++;
        return {};
      },
      flush: async () => true
    };
  })
});

after(() => rmSync(folder, { recursive: true, force: true }));

test("the page is told reports to New Altitude's own address need a sign-in", () => {
  assert.equal(diagnosticsState().account, true);
});

test("signed out, nothing is sent to New Altitude's own address", async () => {
  Sentry.captureException(new Error('signed out, to New Altitude'));
  assert.equal(await Sentry.flush(5000), true);
  assert.equal(sent, 0, 'a report passed the gate while signed out');
  assert.deepEqual(made, [], 'a transport was made with no sign-in');
  assert.ok(signInReads > 0, 'the report never reached the sign-in check');
});
