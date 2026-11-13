// An office no shell started: no ODDBORO_UPDATE_TOKEN, so it has no token to
// compare a report with. update.ts reads the token as it loads, and
// owner-page.test.ts loads it with one, so this office gets a process of its
// own. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RequestEvent } from '@sveltejs/kit';
import { UPDATE_PATH } from '@oddboro/ledger/owner-key';

delete process.env.ODDBORO_UPDATE_TOKEN;
const { guardOffice } = await import('./owner-page.ts');

test('an office no shell started refuses an update report whose token is empty or missing', async () => {
  for (const sent of [{ 'x-oddboro-update-token': '' }, {}] as Record<string, string>[]) {
    const request = new Request(`http://127.0.0.1:4500${UPDATE_PATH}`, {
      method: 'POST',
      headers: { host: '127.0.0.1:4500', ...sent },
      body: '{}'
    });
    const event = {
      request,
      url: new URL(request.url),
      params: {},
      isRemoteRequest: false,
      getClientAddress: () => '127.0.0.1'
    } as unknown as RequestEvent;
    let ran = false;
    const res = await guardOffice({
      event,
      resolve: async () => {
        ran = true;
        return new Response('ok');
      }
    });
    assert.deepEqual([sent, res.status, ran], [sent, 403, false]);
  }
});
