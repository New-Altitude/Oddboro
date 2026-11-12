// The address on Setup's first card, compiled and rendered on the server as
// the page would show it. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import { systemWords } from '@oddboro/ledger/system-words';
import type AddressSectionComponent from './AddressSection.svelte';
import { compiledForServer } from './compiled-for-server.ts';

const AddressSection = await compiledForServer<typeof AddressSectionComponent>(
  join(dirname(fileURLToPath(import.meta.url)), 'AddressSection.svelte')
);

test('an office on a port other than 4500 that could not check port 80 shows its own port in the address', () => {
  const body = render(AddressSection, {
    props: {
      addr: { host: 'oddboro.localhost', port: 4651, state: 'unchecked' },
      words: systemWords('mac')
    }
  }).body;
  assert.match(body, /oddboro\.localhost:4651/);
  assert.doesNotMatch(body, /:4500/);
  assert.match(body, /could not check what holds port 80 on this Mac/);
});
