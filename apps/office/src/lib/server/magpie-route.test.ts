import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const folder = mkdtempSync(join(tmpdir(), 'oddboro-magpie-route-'));
Object.assign(process.env, {
  HOME: folder,
  USERPROFILE: folder,
  ODDBORO_APP: '0',
  ODDBORO_HOME: folder,
  ODDBORO_ENV: join(folder, 'none.env')
});
const { fromOwnerPage, guardOffice } = await import('./owner-page.ts');
const route = await import('../../routes/api/magpie/+server.ts');
after(() => rmSync(folder, { recursive: true, force: true }));
const event = (request: Request) =>
  ({ request, url: new URL(request.url) }) as Parameters<typeof route.GET>[0];

test('Magpie reads and writes require the owner page; the global host guard remains in force', async () => {
  for (const method of ['GET', 'POST']) {
    const handler = method === 'GET' ? route.GET : route.POST;
    for (const origin of ['https://unrelated.test', 'null', '']) {
      const request = new Request('http://127.0.0.1:4500/api/magpie', {
        method,
        headers: { host: '127.0.0.1:4500', ...(origin ? { origin } : {}) },
        ...(method === 'POST' ? { body: '{"action":"disconnect"}' } : {})
      });
      assert.equal(fromOwnerPage(request), false);
      assert.equal((await handler(event(request))).status, 403);
    }
    const good = new Request('http://127.0.0.1:4500/api/magpie', {
      method,
      headers: {
        host: '127.0.0.1:4500',
        origin: 'http://127.0.0.1:4500',
        'sec-fetch-site': 'same-origin'
      },
      ...(method === 'POST' ? { body: '{"action":"disconnect"}' } : {})
    });
    assert.equal((await handler(event(good))).status, 200);
  }
  const rebound = new Request('http://rebound.test:4500/api/magpie', {
    headers: { host: 'rebound.test:4500', 'sec-fetch-site': 'same-origin' }
  });
  const response = await guardOffice({
    event: event(rebound),
    resolve: async () => new Response('should not run')
  });
  assert.equal(response.status, 403);
});

test('bounded Magpie request rejects malformed, unknown and oversized actions', async () => {
  for (const [body, expected] of [
    ['bad-json', 400],
    ['{"action":"arbitrary-forward","url":"https://outside.test"}', 400],
    ['x'.repeat(65 * 1024), 413]
  ] as const) {
    const request = new Request('http://127.0.0.1:4500/api/magpie', {
      method: 'POST',
      headers: { host: '127.0.0.1:4500', 'sec-fetch-site': 'same-origin' },
      body
    });
    assert.equal((await route.POST(event(request))).status, expected);
  }
});
